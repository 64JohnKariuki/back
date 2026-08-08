const express = require('express');
const { 
    createPayment, 
    initiatePayment,
    paymentCallback, 
    paymentStatusWebhook,
    processRefund, 
    initiatePayout, 
    paymentStatusCheck
} = require('../config/intasend'); // Import functions from Intasend integration
const router = express.Router();

// Route to create a payment
router.post('/create', createPayment);

// Route to handle payment callback
router.post('/callback', paymentCallback);

// Route to check payment status
router.get("/payment-status", paymentStatusCheck);

// routes/paymentRoutes.js
router.post("/webhook", paymentStatusWebhook);

// Route to process refunds
router.post('/refund', processRefund);

// Route to handle payouts
router.post('/payout', initiatePayout);

module.exports = router;
