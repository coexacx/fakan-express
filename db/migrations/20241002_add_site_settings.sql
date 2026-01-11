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
);

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
ON CONFLICT (id) DO NOTHING;
