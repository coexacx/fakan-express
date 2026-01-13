require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const PgSession = require('connect-pg-simple')(session);

const { config } = require('./config');
const { pool, ping, ensureSchema } = require('./db');
const { publicRouter } = require('./routes/public');
const { adminRouter } = require('./routes/admin');
const { bootstrapAdminIfNeeded } = require('./services/adminService');
const { releaseExpiredReservations } = require('./services/orderService');
const { getSiteSettings } = require('./services/siteSettingsService');

async function waitForDb(maxRetries = 30) {
  for (let i = 1; i <= maxRetries; i += 1) {
    try {
      await ping();
      return;
    } catch (e) {
      const delay = Math.min(1000 * i, 5000);
      console.log(`[db] not ready (try ${i}/${maxRetries}), retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Database not ready after retries');
}

async function main() {
  await waitForDb();
  await ensureSchema();

  // Bootstrap first admin account if needed
  try {
    const out = await bootstrapAdminIfNeeded({
      username: config.bootstrapAdminUsername,
      password: config.bootstrapAdminPassword,
    });
    if (out.created) {
      console.log(`[bootstrap] Admin created: ${out.admin.username}`);
    } else {
      console.log(`[bootstrap] Admin not created (${out.reason})`);
    }
  } catch (e) {
    console.log(`[bootstrap] Failed: ${e.message}`);
  }

  // Run cleanup job once on startup, then periodically
  try {
    await releaseExpiredReservations();
  } catch (e) {
    console.log(`[job] initial releaseExpiredReservations failed: ${e.message}`);
  }
  setInterval(() => {
    releaseExpiredReservations().catch((e) => console.log(`[job] releaseExpiredReservations failed: ${e.message}`));
  }, 60 * 1000);

  const app = express();

  if (config.trustProxy && config.trustProxy > 0) {
    app.set('trust proxy', config.trustProxy);
  }

  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');

  app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

  // For HTML forms
  app.use(express.urlencoded({ extended: false }));

  // For webhook JSON; also capture raw body for HMAC verification.
  app.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf ? buf.toString('utf8') : '';
      },
    })
  );

  // Sessions
  app.use(
    session({
      store: new PgSession({
        pool,
        createTableIfMissing: true,
      }),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  // Simple flash helper
  app.use((req, res, next) => {
    res.locals.admin = req.session.admin || null;

    res.locals.flash = req.session.flash || null;
    delete req.session.flash;

    next();
  });

  app.use(async (req, res, next) => {
    try {
      res.locals.siteSettings = await getSiteSettings();
    } catch (e) {
      res.locals.siteSettings = null;
    }
    next();
  });

  // Rate limiters
  const publicLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const orderLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const adminLoginLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/static', express.static(path.join(__dirname, 'static')));

  // Global public limiter
  app.use(publicLimiter);

  // More strict for creating orders
  app.use('/order', orderLimiter);

  // Public routes
  app.use('/', publicRouter);

  // Admin routes (limit login brute force)
  app.use('/admin/login', adminLoginLimiter);
  app.use('/admin', adminRouter);

  app.use((req, res) => {
    res.status(404).send('404 Not Found');
  });

  app.listen(config.port, () => {
    console.log(`fakan-express listening on http://0.0.0.0:${config.port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
