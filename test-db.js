const mysql = require("mysql2/promise");
require("dotenv").config();

async function testConnection() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      socketPath: process.env.DB_SOCKET,
    });

    console.log("✅ MySQL connected successfully");
    await conn.end();
  } catch (err) {
    console.error("❌ MySQL connection failed:", err.message);
  }
}

testConnection();
