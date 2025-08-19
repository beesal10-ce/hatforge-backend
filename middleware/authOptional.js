// middleware/authOptional.js
const jwt = require('jsonwebtoken');

module.exports = function authOptional(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer\s+(.+)$/i);
    if (!m) return next(); // no token -> proceed as guest

    const token = m[1];
    const secret = process.env.JWT_SECRET;
    if (!secret) return next(); // no secret set -> skip

    const payload = jwt.verify(token, secret);
    // expect { id, name, email, ... }
    req.user = { id: payload.id, name: payload.name, email: payload.email };
  } catch {
    // bad/expired token? ignore (this is optional auth)
  }
  next();
};
