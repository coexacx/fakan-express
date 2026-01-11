-- Basic schema for fakan-express
-- Runs automatically when the Postgres container is created for the first time.

CREATE TABLE IF NOT EXISTS admins (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  customer_contact TEXT NOT NULL,
  customer_note TEXT,
  status TEXT NOT NULL, -- pending/paid/delivered/expired/canceled/delivery_failed
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  reserved_expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty INT NOT NULL CHECK (qty > 0),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

CREATE TABLE IF NOT EXISTS card_keys (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code_encrypted TEXT NOT NULL,
  code_sha256 TEXT NOT NULL,
  status TEXT NOT NULL, -- available/reserved/sold
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  reserved_until TIMESTAMPTZ,
  sold_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_keys_product_status ON card_keys(product_id, status);
CREATE INDEX IF NOT EXISTS idx_card_keys_reserved_until ON card_keys(reserved_until);
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_keys_product_codehash ON card_keys(product_id, code_sha256);
