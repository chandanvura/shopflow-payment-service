const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const client = require('prom-client');
const { connectRabbitMQ } = require('./src/messaging/consumer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3005;

// Prometheus
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestCounter = new client.Counter({
  name: 'payment_service_requests_total',
  help: 'Total requests to payment service',
  labelNames: ['method', 'route', 'status'],
  registers: [register]
});

const paymentsProcessed = new client.Counter({
  name: 'payments_processed_total',
  help: 'Total payments processed',
  labelNames: ['status'],
  registers: [register]
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestCounter.inc({ method: req.method, route: req.path, status: res.statusCode });
  });
  next();
});

// Connect MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// Start RabbitMQ consumer
connectRabbitMQ();

// Routes
app.use('/api/payments', require('./src/routes/payments'));

// Health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'payment-service',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Metrics
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  console.log(`Payment Service running on port ${PORT}`);
});