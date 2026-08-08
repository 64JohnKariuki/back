// database/connection.js
const mysql = require("mysql");
const dotenv = require("dotenv");

// Load environment variables based on NODE_ENV
dotenv.config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});

// Validate required environment variables
// 💡 REMOVED 'DB_PASSWORD' from required fields so local dev can bypass it safely
const requiredEnvVars = ['DB_HOST', 'DB_USERNAME', 'DB_DATABASE'];
requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    throw new Error(`❌ FATAL: Missing required environment variable: ${envVar}`);
  }
});

// Strict production enforcement: Ensure password exists if running in production
if (process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) {
  throw new Error("❌ FATAL: DB_PASSWORD must be set in a production environment.");
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USERNAME,
  // Safely falls back to an empty string for local development environments
  password: process.env.DB_PASSWORD || '', 
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 10,
  queueLimit: 0,
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: true,
  decimalNumbers: true,
  charset: 'utf8mb4',
  strict: true,
  multipleStatements: false, // Prevent SQL injection vectors
});

// Fixed: Replaced Promise syntax (.then/.catch) with traditional callback syntax supported by the legacy 'mysql' driver
pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
  
  console.log('✅ Database connection pool established');
  connection.release(); // Return connection back to the pool
});

module.exports = pool;