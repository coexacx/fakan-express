const { pool } = require('../db');

const defaultSettings = {
  site_title: '发卡站',
  footer_left: '© 2026 发卡站',
  footer_right: '订单链接包含访问凭证，请妥善保存，勿外泄。',
  announcement: '',
  top_bg_color: '#f6f7fb',
  middle_bg_color: '#f6f7fb',
  card_bg_color: '#ffffff',
  footer_bg_color: '#f6f7fb',
  middle_bg_image_url: '',
};

async function ensureRow() {
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
    VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (id) DO NOTHING
    `,
    [
      defaultSettings.site_title,
      defaultSettings.footer_left,
      defaultSettings.footer_right,
      defaultSettings.announcement,
      defaultSettings.top_bg_color,
      defaultSettings.middle_bg_color,
      defaultSettings.card_bg_color,
      defaultSettings.footer_bg_color,
      defaultSettings.middle_bg_image_url,
    ]
  );
}

async function getSiteSettings() {
  await ensureRow();
  const { rows } = await pool.query(
    `
    SELECT site_title, footer_left, footer_right, announcement,
      top_bg_color, middle_bg_color, card_bg_color, footer_bg_color, middle_bg_image_url
    FROM site_settings
    WHERE id = 1
    `
  );
  const row = rows[0];
  return row ? { ...defaultSettings, ...row } : { ...defaultSettings };
}

async function updateSiteSettings({
  siteTitle,
  footerLeft,
  footerRight,
  announcement,
  topBgColor,
  middleBgColor,
  cardBgColor,
  footerBgColor,
  middleBgImageUrl,
}) {
  const payload = {
    siteTitle: siteTitle || defaultSettings.site_title,
    footerLeft: footerLeft || defaultSettings.footer_left,
    footerRight: footerRight || defaultSettings.footer_right,
    announcement: announcement || '',
    topBgColor: topBgColor || defaultSettings.top_bg_color,
    middleBgColor: middleBgColor || defaultSettings.middle_bg_color,
    cardBgColor: cardBgColor || defaultSettings.card_bg_color,
    footerBgColor: footerBgColor || defaultSettings.footer_bg_color,
    middleBgImageUrl: middleBgImageUrl || defaultSettings.middle_bg_image_url,
  };

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
      middle_bg_image_url,
      updated_at
    )
    VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (id) DO UPDATE SET
      site_title = EXCLUDED.site_title,
      footer_left = EXCLUDED.footer_left,
      footer_right = EXCLUDED.footer_right,
      announcement = EXCLUDED.announcement,
      top_bg_color = EXCLUDED.top_bg_color,
      middle_bg_color = EXCLUDED.middle_bg_color,
      card_bg_color = EXCLUDED.card_bg_color,
      footer_bg_color = EXCLUDED.footer_bg_color,
      middle_bg_image_url = EXCLUDED.middle_bg_image_url,
      updated_at = NOW()
    `,
    [
      payload.siteTitle,
      payload.footerLeft,
      payload.footerRight,
      payload.announcement,
      payload.topBgColor,
      payload.middleBgColor,
      payload.cardBgColor,
      payload.footerBgColor,
      payload.middleBgImageUrl,
    ]
  );

  return getSiteSettings();
}

module.exports = { getSiteSettings, updateSiteSettings, defaultSettings };
