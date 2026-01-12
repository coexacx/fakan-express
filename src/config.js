const assert = require('assert');

function env(name, fallback = undefined) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v;
}

function envInt(name, fallback) {
  const v = env(name, undefined);
  if (v === undefined) return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return n;
}

const config = {
  port: envInt('PORT', 3000),
  nodeEnv: env('NODE_ENV', 'development'),
  sessionSecret: env('SESSION_SECRET', 'change_me'),
  cardSecret: env('CARD_SECRET', 'change_me'),
  reserveMinutes: envInt('RESERVE_MINUTES', 30),

  // If you put this app behind HTTPS reverse proxy (Nginx/Caddy), set COOKIE_SECURE=true
  cookieSecure: env('COOKIE_SECURE', 'false') === 'true',
  trustProxy: envInt('TRUST_PROXY', 1),

  bootstrapAdminUsername: env('BOOTSTRAP_ADMIN_USERNAME', ''),
  bootstrapAdminPassword: env('BOOTSTRAP_ADMIN_PASSWORD', ''),

  paymentWebhookSecret: env('PAYMENT_WEBHOOK_SECRET', ''),

  databaseUrl: env('DATABASE_URL', ''),
  dbHost: env('DB_HOST', '127.0.0.1'),
  dbPort: envInt('DB_PORT', 5432),
  dbName: env('DB_NAME', 'fakan'),
  dbUser: env('DB_USER', 'postgres'),
  dbPassword: env('DB_PASSWORD', 'postgres'),
};

assert(config.sessionSecret && config.sessionSecret.length >= 8, 'SESSION_SECRET must be set and >= 8 chars');
assert(config.cardSecret && config.cardSecret.length >= 8, 'CARD_SECRET must be set and >= 8 chars');

module.exports = { config };
