// controllers/adminController.js
const jwt = require('jsonwebtoken');
const db = require('../db');

exports.login = async (req, res) => {
  const { username, password } = req.body;

  // 1. Check the provided username and password against your .env variables
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {

    // 2. If they match, create a secure token (JWT)
    const token = jwt.sign(
      { role: 'admin' }, // Payload: identifies the user as an admin
      process.env.JWT_SECRET, // The secret key to sign the token
      { expiresIn: '8h' } // Token will expire in 8 hours
    );

    // 3. Send the token back to the frontend
    return res.status(200).json({ message: 'Login successful', token });
  }

  // If credentials do not match, send an error
  return res.status(401).json({ message: 'Invalid credentials' });
};

exports.getAllOrders = async (req, res) => {
    try {
      // ✅ REVISED AND CORRECTED QUERY
      // This query correctly joins orders with their items and screenshots.
      const query = `
        SELECT
          o.id AS order_id,
          o.order_status AS status, -- Using your 'order_status' column
          o.created_at,
          o.full_name AS customer_name,
          o.email AS customer_email,
          o.amount_total_cents,
          oi.id AS item_id,
          oi.hat_type,
          oi.hat_color,
          oi.notes,
          ois.view_name,
          ois.screenshot_base64
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN order_item_screens ois ON oi.id = ois.order_item_id
        ORDER BY o.created_at DESC;
      `;
      const [rows] = await db.query(query);
  
      // The logic below to process the rows is correct and does not need to be changed.
      const orders = {};
      for (const row of rows) {
        if (!orders[row.order_id]) {
          orders[row.order_id] = {
            id: row.order_id,
            status: row.status || 'new', // Default to 'new' if status is null
            createdAt: row.created_at,
            customerName: row.customer_name,
            customerEmail: row.customer_email,
            total: (row.amount_total_cents / 100).toFixed(2),
            items: [],
          };
        }
  
        let item = orders[row.order_id].items.find(i => i.id === row.item_id);
        if (!item) {
          item = {
            id: row.item_id,
            hatType: row.hat_type,
            hatColor: row.hat_color,
            notes: row.notes,
            screenshots: {},
          };
          orders[row.order_id].items.push(item);
        }
  
        if (row.view_name && row.screenshot_base64) {
          item.screenshots[row.view_name] = row.screenshot_base64;
        }
      }
      
      res.json(Object.values(orders));
  
    } catch (error) {
      console.error('Error fetching all orders:', error);
      res.status(500).json({ message: 'Failed to fetch orders' });
    }
  };
  