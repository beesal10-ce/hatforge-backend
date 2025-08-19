// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const adminCtrl = require('../controllers/adminController');
const isAdmin = require('../middleware/isAdmin');

// Define the login route
// POST /api/admin/login
router.post('/login', adminCtrl.login);

router.get('/test', isAdmin, (req, res) => {
    // Because of the isAdmin middleware, this code will only run if a valid token is provided.
    // The middleware also added the user payload to the request.
    res.json({ message: `Welcome, admin! Your role is: ${req.user.role}` });
  });

  router.get('/orders', isAdmin, adminCtrl.getAllOrders);

module.exports = router;