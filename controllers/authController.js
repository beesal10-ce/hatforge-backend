const db = require('../db');
const bcrypt = require('bcrypt');

exports.registerUser = async (req, res) => {
  const { fullName, phone, email, password } = req.body;

  if (!fullName || !phone || !email || !password) {
    return res.status(400).json({ message: 'Please fill all fields.' });
  }

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      'INSERT INTO users (full_name, phone_number, email, password) VALUES (?, ?, ?, ?)',
      [fullName, phone, email, hashedPassword]
    );

    res.status(201).json({ message: 'User registered successfully ✅' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

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

    res.status(200).json({ message: 'Login successful ✅', user: { id: user.id, name: user.full_name, email: user.email } });
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};
