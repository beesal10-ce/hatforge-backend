const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
dotenv.config();

// console.log("ENV:", process.env.DB_HOST, process.env.DB_USER, `"${process.env.DB_PASS}"`, process.env.DB_NAME);  // to confirm password is blank

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS || "",  // fallback to empty string
  database: process.env.DB_NAME,
  socketPath: process.env.DB_SOCKET,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
