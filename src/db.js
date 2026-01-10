const { Pool } = require('pg');
const { config } = require('./config');

const pool = new Pool(
  config.databaseUrl
    ? { connectionString: config.databaseUrl }
    : {
        host: config.dbHost,
        port: config.dbPort,
        database: config.dbName,
        user: config.dbUser,
        password: config.dbPassword,
      }
);

async function ping() {
  await pool.query('SELECT 1 AS ok');
}

async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function tx(fn) {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        // ignore rollback error
      }
      throw err;
    }
  });
}

module.exports = { pool, ping, withClient, tx };
