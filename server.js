const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');

const db = require('./db'); 
const authRoutes = require('./routes/authRoutes'); 
const paymentRoutes = require('./routes/paymentRoutes');
const orderRoutes = require('./routes/orderRoutes'); 
const adminRoutes = require('./routes/adminRoutes');

dotenv.config();

const app = express();

// ⚠️ increase limits for screenshots (tune as needed)
app.use(express.json({ limit: '80mb' }));
app.use(express.urlencoded({ limit: '80mb', extended: true }));

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('🎩 Welcome to HatStore Backend API');
});

app.use('/api/auth', authRoutes);


app.use('/api/checkout', paymentRoutes); // -> POST /api/checkout/create-intent
app.use('/api/orders', orderRoutes); 
app.use('/api/admin', adminRoutes);


const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// Optional error logger
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
