CREATE TABLE IF NOT EXISTS site_settings (
  id SMALLINT PRIMARY KEY,
  site_title TEXT NOT NULL,
  footer_left TEXT NOT NULL,
  footer_right TEXT NOT NULL,
  announcement TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO site_settings (id, site_title, footer_left, footer_right, announcement)
VALUES (1, '发卡站', '© 2026 发卡站', '订单链接包含访问凭证，请妥善保存，勿外泄。', '')
ON CONFLICT (id) DO NOTHING;
