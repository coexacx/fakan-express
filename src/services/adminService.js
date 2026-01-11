const bcrypt = require('bcrypt');
const { pool } = require('../db');

async function findAdminByUsername(username) {
  const { rows } = await pool.query('SELECT id, username, password_hash FROM admins WHERE username = $1', [username]);
  return rows[0] || null;
}

async function verifyAdminPassword(adminRow, password) {
  return bcrypt.compare(password, adminRow.password_hash);
}

async function adminCount() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM admins');
  return rows[0].c;
}

async function createAdmin(username, password) {
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    'INSERT INTO admins (username, password_hash) VALUES ($1, $2) RETURNING id, username',
    [username, passwordHash]
  );
  return rows[0];
}

async function updateAdminCredentials(adminId, { username, password }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    'UPDATE admins SET username = $1, password_hash = $2 WHERE id = $3 RETURNING id, username',
    [username, passwordHash, adminId]
  );
  return rows[0];
}

async function bootstrapAdminIfNeeded({ username, password }) {
  if (!username || !password) return { created: false, reason: 'missing_env' };

  const count = await adminCount();
  if (count > 0) return { created: false, reason: 'already_exists' };

  const admin = await createAdmin(username, password);
  return { created: true, admin };
}

module.exports = {
  findAdminByUsername,
  verifyAdminPassword,
  createAdmin,
  updateAdminCredentials,
  bootstrapAdminIfNeeded,
};
