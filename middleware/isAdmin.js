// middleware/isAdmin.js
const jwt = require('jsonwebtoken');

const isAdmin = (req, res, next) => {
  // 1. Get the token from the request header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format is "Bearer TOKEN"

  if (token == null) {
    // If there's no token, deny access
    return res.status(401).json({ message: 'Unauthorized: No token provided' });
  }

  // 2. Verify the token is valid and not expired
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      // If the token is invalid (or expired), deny access
      return res.status(403).json({ message: 'Forbidden: Invalid token' });
    }

    // 3. If the token is valid, attach the user payload to the request
    //    and allow the request to proceed to the next function (the controller).
    req.user = user;
    next();
  });
};

module.exports = isAdmin;