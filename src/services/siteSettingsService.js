const { pool } = require('../db');

const defaultSettings = {
  site_title: '发卡站',
  footer_left: '© 2026 发卡站',
  footer_right: '订单链接包含访问凭证，请妥善保存，勿外泄。',
  announcement: '',
};

async function ensureRow() {
  await pool.query(
    `
    INSERT INTO site_settings (id, site_title, footer_left, footer_right, announcement)
    VALUES (1, $1, $2, $3, $4)
    ON CONFLICT (id) DO NOTHING
    `,
    [
      defaultSettings.site_title,
      defaultSettings.footer_left,
      defaultSettings.footer_right,
      defaultSettings.announcement,
    ]
  );
}

async function getSiteSettings() {
  await ensureRow();
  const { rows } = await pool.query(
    `
    SELECT site_title, footer_left, footer_right, announcement
    FROM site_settings
    WHERE id = 1
    `
  );
  const row = rows[0];
  return row ? { ...defaultSettings, ...row } : { ...defaultSettings };
}

async function updateSiteSettings({ siteTitle, footerLeft, footerRight, announcement }) {
  const payload = {
    siteTitle: siteTitle || defaultSettings.site_title,
    footerLeft: footerLeft || defaultSettings.footer_left,
    footerRight: footerRight || defaultSettings.footer_right,
    announcement: announcement || '',
  };

  await pool.query(
    `
    INSERT INTO site_settings (id, site_title, footer_left, footer_right, announcement, updated_at)
    VALUES (1, $1, $2, $3, $4, NOW())
    ON CONFLICT (id) DO UPDATE SET
      site_title = EXCLUDED.site_title,
      footer_left = EXCLUDED.footer_left,
      footer_right = EXCLUDED.footer_right,
      announcement = EXCLUDED.announcement,
      updated_at = NOW()
    `,
    [payload.siteTitle, payload.footerLeft, payload.footerRight, payload.announcement]
  );

  return getSiteSettings();
}

module.exports = { getSiteSettings, updateSiteSettings, defaultSettings };
