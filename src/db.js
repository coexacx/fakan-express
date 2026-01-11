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

async function ensureSchema() {
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id SMALLINT PRIMARY KEY,
      site_title TEXT NOT NULL,
      footer_left TEXT NOT NULL,
      footer_right TEXT NOT NULL,
      announcement TEXT NOT NULL DEFAULT '',
      top_bg_color TEXT NOT NULL DEFAULT '#f6f7fb',
      middle_bg_color TEXT NOT NULL DEFAULT '#f6f7fb',
      card_bg_color TEXT NOT NULL DEFAULT '#ffffff',
      footer_bg_color TEXT NOT NULL DEFAULT '#f6f7fb',
      middle_bg_image_url TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS top_bg_color TEXT NOT NULL DEFAULT '#f6f7fb'`);
  await pool.query(`ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS middle_bg_color TEXT NOT NULL DEFAULT '#f6f7fb'`);
  await pool.query(`ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS card_bg_color TEXT NOT NULL DEFAULT '#ffffff'`);
  await pool.query(`ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS footer_bg_color TEXT NOT NULL DEFAULT '#f6f7fb'`);
  await pool.query(`ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS middle_bg_image_url TEXT`);
  await pool.query(
    `
    INSERT INTO site_settings (
      id,
      site_title,
      footer_left,
      footer_right,
      announcement,
      top_bg_color,
      middle_bg_color,
      card_bg_color,
      footer_bg_color,
      middle_bg_image_url
    )
    VALUES (
      1,
      '发卡站',
      '© 2026 发卡站',
      '订单链接包含访问凭证，请妥善保存，勿外泄。',
      '',
      '#f6f7fb',
      '#f6f7fb',
      '#ffffff',
      '#f6f7fb',
      NULL
    )
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `
    INSERT INTO site_settings (id, site_title, footer_left, footer_right, announcement)
    VALUES (1, '发卡站', '© 2026 发卡站', '订单链接包含访问凭证，请妥善保存，勿外泄。', '')
    ON CONFLICT (id) DO NOTHING
    `
  );
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

module.exports = { pool, ping, ensureSchema, withClient, tx };
