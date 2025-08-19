const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// --- SIGN UP: auto sign-in on success ---
exports.registerUser = async (req, res) => {
  const { fullName, phone, email, password } = req.body;

  if (!fullName || !phone || !email || !password) {
    return res.status(400).json({ message: 'Please fill all fields.' });
  }

  try {
    // Uniqueness checks
    const [emailRows] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (emailRows.length > 0) {
      return res.status(409).json({ message: 'Email already registered.' });
    }
    const [phoneRows] = await db.query('SELECT id FROM users WHERE phone_number = ?', [phone]);
    if (phoneRows.length > 0) {
      return res.status(409).json({ message: 'Phone number already registered.' });
    }

    // Hash password & insert
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (full_name, phone_number, email, password) VALUES (?, ?, ?, ?)',
      [fullName, phone, email, hashedPassword]
    );

    // Create JWT so the user is signed in immediately
    const token = jwt.sign(
      { id: result.insertId, name: fullName, email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(201).json({
      message: 'User registered successfully ✅',
      token, // <-- frontend will store this
      user: { id: result.insertId, name: fullName, email }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// --- LOGIN (already good, unchanged) ---
exports.loginUser = async (req, res) => {
  const { emailOrPhone, password } = req.body;

  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE email = ? OR phone_number = ?',
      [emailOrPhone, emailOrPhone]
    );
    if (rows.length === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    const user = rows[0];
    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.full_name, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({
      message: 'Login successful ✅',
      token,
      user: { id: user.id, name: user.full_name, email: user.email }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};
