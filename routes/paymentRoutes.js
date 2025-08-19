// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Create a PaymentIntent + tax calculation (Stripe Tax)
router.post('/create-intent', paymentController.createIntent);

module.exports = router;
