const { Pool } = require('pg');

function getDatabaseUrlForPg(rawUrl) {
  if (!rawUrl) return undefined;
  try {
    const u = new URL(rawUrl);
    // libpq-style params sometimes appear in managed Postgres URLs (e.g. Neon).
    // Node-postgres doesn't need them and some can cause parse issues.
    u.searchParams.delete('sslmode');
    u.searchParams.delete('channel_binding');
    return u.toString();
  } catch {
    // If it's not a valid WHATWG URL, let pg try to handle it as-is.
    return rawUrl;
  }
}

// Railway/Neon provide DATABASE_URL as a single connection string
// Local dev uses individual DB_HOST, DB_PORT etc from .env
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: getDatabaseUrlForPg(process.env.DATABASE_URL),
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        // Managed/remote Postgres can take longer to establish TLS.
        connectionTimeoutMillis: 10000,
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
