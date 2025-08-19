const express = require('express');
const router = express.Router();
const orderCtrl = require('../controllers/ordersController');
const authOptional = require('../middleware/authOptional');


// Create order (meta only; no large base64 here)
router.post('/', authOptional, orderCtrl.createOrder);

// Upload heavy assets (screenshots, attachments) separately
router.post('/:orderId/assets', authOptional, orderCtrl.uploadAssets);


const bigJson = express.json({ limit: '20mb' });
router.post('/:orderId/quote', authOptional, bigJson, orderCtrl.attachQuotePdf);

router.get('/:orderId/quote', authOptional, orderCtrl.downloadQuotePdf);


router.post('/send-confirmation', orderCtrl.sendConfirmationEmail);


module.exports = router;
