const { pool } = require('../db');

const defaultSettings = {
  gateway_url: '',
  merchant_id: '',
  merchant_key: '',
  // 可选：用于生成 notify_url / return_url 的回调域名（例如 https://example.com）
  // 留空时会根据请求的 Host 自动推断（反代未正确传 Host 时可能变成 127.0.0.1）
  callback_base_url: '',
  fee_percent: 0,
};

async function ensureTable() {
  await pool.query(
    `
    CREATE TABLE IF NOT EXISTS payment_settings (
      id SMALLINT PRIMARY KEY,
      gateway_url TEXT NOT NULL DEFAULT '',
      merchant_id TEXT NOT NULL DEFAULT '',
      merchant_key TEXT NOT NULL DEFAULT '',
      callback_base_url TEXT NOT NULL DEFAULT '',
      fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (fee_percent >= 0 AND fee_percent <= 100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `
  );

  // 兼容旧版本：补列
  await pool.query(
    `ALTER TABLE payment_settings ADD COLUMN IF NOT EXISTS callback_base_url TEXT NOT NULL DEFAULT ''`
  );
}

async function ensureRow() {
  await ensureTable();
  await pool.query(
    `
    INSERT INTO payment_settings (
      id,
      gateway_url,
      merchant_id,
      merchant_key,
      callback_base_url,
      fee_percent
    )
    VALUES (1, $1, $2, $3, $4, $5)
    ON CONFLICT (id) DO NOTHING
    `,
    [
      defaultSettings.gateway_url,
      defaultSettings.merchant_id,
      defaultSettings.merchant_key,
      defaultSettings.callback_base_url,
      defaultSettings.fee_percent,
    ]
  );
}

function validateGatewayUrl(gatewayUrl) {
  try {
    const parsed = new URL(gatewayUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('支付网关地址不正确');
    }
  } catch (e) {
    if (e.message === '支付网关地址不正确') {
      throw e;
    }
    throw new Error('支付网关地址不正确');
  }
}

function normalizeBaseUrl(baseUrl) {
  const v = String(baseUrl || '').trim();
  if (!v) return '';
  const parsed = new URL(v);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('回调域名必须是 http(s):// 开头');
  }
  // 去掉结尾的 /，避免拼接出双斜杠
  return parsed.toString().replace(/\/$/, '');
}

async function getPaymentSettings() {
  await ensureRow();
  const { rows } = await pool.query(
    `
    SELECT gateway_url, merchant_id, merchant_key, callback_base_url, fee_percent::float8 AS fee_percent
    FROM payment_settings
    WHERE id = 1
    `
  );
  const row = rows[0];
  return row ? { ...defaultSettings, ...row } : { ...defaultSettings };
}

async function updatePaymentSettings({
  gatewayUrl,
  merchantId,
  merchantKey,
  callbackBaseUrl,
  feePercent,
}) {
  const trimmedGatewayUrl = String(gatewayUrl || '').trim();
  const trimmedMerchantId = String(merchantId || '').trim();
  const trimmedMerchantKey = String(merchantKey || '').trim();
  const normalizedCallbackBaseUrl = normalizeBaseUrl(callbackBaseUrl);
  const feeValue = Number(feePercent);

  if (!trimmedGatewayUrl) {
    throw new Error('支付网关不能为空');
  }
  if (!trimmedMerchantId) {
    throw new Error('商户ID不能为空');
  }
  if (!trimmedMerchantKey) {
    throw new Error('商户密钥不能为空');
  }
  if (!Number.isFinite(feeValue) || feeValue < 0 || feeValue > 100) {
    throw new Error('手续费需在 0-100 之间');
  }

  validateGatewayUrl(trimmedGatewayUrl);

  await pool.query(
    `
    INSERT INTO payment_settings (
      id,
      gateway_url,
      merchant_id,
      merchant_key,
      callback_base_url,
      fee_percent,
      updated_at
    )
    VALUES (1, $1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE SET
      gateway_url = EXCLUDED.gateway_url,
      merchant_id = EXCLUDED.merchant_id,
      merchant_key = EXCLUDED.merchant_key,
      callback_base_url = EXCLUDED.callback_base_url,
      fee_percent = EXCLUDED.fee_percent,
      updated_at = NOW()
    `,
    [trimmedGatewayUrl, trimmedMerchantId, trimmedMerchantKey, normalizedCallbackBaseUrl, feeValue]
  );

  return getPaymentSettings();
}

module.exports = { getPaymentSettings, updatePaymentSettings, defaultSettings };
