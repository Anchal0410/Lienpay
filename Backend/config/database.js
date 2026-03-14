const { Pool } = require('pg');

// Railway provides DATABASE_URL as a single connection string
// Local dev uses individual DB_HOST, DB_PORT etc from .env
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || 'lienpay_db',
        user:     process.env.DB_USER     || 'lienpay_user',
        password: process.env.DB_PASSWORD,
        ssl:      false,
        max:      20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
);

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

const testConnection = async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL connected:', res.rows[0].now);
  } catch (err) {
    console.error('❌ PostgreSQL connection failed:', err.message);
    process.exit(1);
  }
};

module.exports = { pool, query, getClient, testConnection };
