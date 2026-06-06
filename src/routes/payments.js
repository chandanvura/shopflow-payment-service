const express = require('express');
const router = express.Router();
const { getPaymentByOrder, getAllPayments } = require('../controllers/paymentController');

router.get('/', getAllPayments);
router.get('/order/:orderId', getPaymentByOrder);

module.exports = router;