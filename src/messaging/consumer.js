const amqp = require('amqplib');
const Payment = require('../models/Payment');
const axios = require('axios');

let connection;
let channel;

// Mock payment processor
const processPayment = async (amount) => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  // 90% success rate (mock)
  const success = Math.random() > 0.1;
  return {
    success,
    transactionId: success ? `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}` : null
  };
};

// Update order status via HTTP
const updateOrderStatus = async (orderId, status, paymentStatus) => {
  try {
    await axios.put(
      `${process.env.ORDER_SERVICE_URL}/internal/orders/${orderId}/status`,
      { status, paymentStatus }
    );
    console.log(`Order ${orderId} updated: ${status}`);
  } catch (error) {
    console.error(`Failed to update order ${orderId}:`, error.message);
  }
};

const connectRabbitMQ = async () => {
  try {
    connection = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await connection.createChannel();

    // Listen to order.created queue
    await channel.assertQueue('order.created', { durable: true });
    channel.prefetch(1);

    console.log('Waiting for messages in order.created queue...');

    channel.consume('order.created', async (msg) => {
      if (!msg) return;

      const orderData = JSON.parse(msg.content.toString());
      console.log(`Processing payment for order: ${orderData.orderId}`);

      try {
        // Create payment record
        const payment = await Payment.create({
          orderId: orderData.orderId,
          userId: orderData.userId,
          userEmail: orderData.userEmail,
          amount: orderData.totalAmount,
          status: 'processing'
        });

        // Update order to processing
        await updateOrderStatus(orderData.orderId, 'processing', 'processing');

        // Process payment (mock)
        const result = await processPayment(orderData.totalAmount);

        if (result.success) {
          // Payment successful
          payment.status = 'completed';
          payment.transactionId = result.transactionId;
          payment.processedAt = new Date();
          await payment.save();

          await updateOrderStatus(orderData.orderId, 'paid', 'completed');

          console.log(`✅ Payment SUCCESS for order ${orderData.orderId} — TXN: ${result.transactionId}`);
        } else {
          // Payment failed
          payment.status = 'failed';
          await payment.save();

          await updateOrderStatus(orderData.orderId, 'cancelled', 'failed');

          console.log(`❌ Payment FAILED for order ${orderData.orderId}`);
        }

        // Acknowledge message
        channel.ack(msg);

      } catch (error) {
        console.error('Payment processing error:', error.message);
        channel.nack(msg, false, true); // Requeue message
      }
    });

  } catch (error) {
    console.error('RabbitMQ connection failed:', error.message);
    setTimeout(connectRabbitMQ, 5000);
  }
};

module.exports = { connectRabbitMQ };