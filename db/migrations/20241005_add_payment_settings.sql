CREATE TABLE IF NOT EXISTS payment_settings (
  id SMALLINT PRIMARY KEY,
  gateway_url TEXT NOT NULL DEFAULT '',
  merchant_id TEXT NOT NULL DEFAULT '',
  merchant_key TEXT NOT NULL DEFAULT '',
  fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (fee_percent >= 0 AND fee_percent <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO payment_settings (
  id,
  gateway_url,
  merchant_id,
  merchant_key,
  fee_percent
)
VALUES (1, '', '', '', 0)
ON CONFLICT (id) DO NOTHING;
