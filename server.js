const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const db = require('./db'); // Ensure db.js exists and is correct
const authRoutes = require('./routes/authRoutes'); // Make sure path is correct

dotenv.config();

const app = express();

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('🎩 Welcome to HatStore Backend API');
});

app.use('/api/auth', authRoutes);

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// Optional error logger
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
