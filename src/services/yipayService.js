const crypto = require('crypto');

const DEFAULT_PAYMENT_METHODS = [
  { type: 'alipay', label: '支付宝' },
  { type: 'wxpay', label: '微信支付' },
];

const PAYMENT_LABELS = {
  alipay: '支付宝',
  alipayh5: '支付宝',
  ali: '支付宝',
  wxpay: '微信支付',
  wechat: '微信支付',
  wechatpay: '微信支付',
  qqpay: 'QQ钱包',
  tenpay: 'QQ钱包',
  bank: '银行卡',
  unionpay: '银联支付',
  jdpay: '京东支付',
};

function buildMd5(text) {
  return crypto.createHash('md5').update(String(text), 'utf8').digest('hex');
}

function buildYipaySign(params, key, fields) {
  const payload = fields.map((field) => String(params[field] ?? '')).join('');
  return buildMd5(`${payload}${key}`);
}

function normalizePaymentType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw in PAYMENT_LABELS) return raw === 'ali' ? 'alipay' : raw === 'wechat' || raw === 'wechatpay' ? 'wxpay' : raw;
  return raw;
}

function resolveGatewayEndpoint(gatewayUrl, endpoint) {
  if (!gatewayUrl) return '';
  try {
    const parsed = new URL(gatewayUrl);
    const pathname = parsed.pathname || '/';
    const trimmed = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    const lastSlash = trimmed.lastIndexOf('/');
    const dir = lastSlash >= 0 ? trimmed.slice(0, lastSlash + 1) : '/';
    const file = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;

    if (file.endsWith('.php')) {
      parsed.pathname = `${dir}${endpoint}.php`;
    } else {
      const base = pathname.endsWith('/') ? pathname : `${pathname}/`;
      parsed.pathname = `${base}${endpoint}.php`;
    }

    return parsed.toString();
  } catch (e) {
    return gatewayUrl;
  }
}

function getGatewayEndpoints(gatewayUrl) {
  return {
    submitUrl: resolveGatewayEndpoint(gatewayUrl, 'submit'),
    mapiUrl: resolveGatewayEndpoint(gatewayUrl, 'mapi'),
  };
}

function toMethodEntry(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const type = normalizePaymentType(raw);
    if (!type) return null;
    return { type, label: PAYMENT_LABELS[type] || raw };
  }
  if (typeof raw === 'object') {
    const type = normalizePaymentType(raw.type || raw.paytype || raw.code || raw.id || raw.value);
    if (!type) return null;
    const label = raw.name || raw.label || PAYMENT_LABELS[type] || type;
    return { type, label };
  }
  return null;
}

function parseMethodList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (payload.data) {
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.data.paytype)) return payload.data.paytype;
    if (Array.isArray(payload.data.types)) return payload.data.types;
  }
  if (Array.isArray(payload.paytype)) return payload.paytype;
  if (Array.isArray(payload.types)) return payload.types;
  if (payload.paytype) return payload.paytype;
  if (payload.type) return payload.type;
  return [];
}

function parsePaymentResponse(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const list = parseMethodList(parsed);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return text
      .split(/[\n,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function normalizePaymentMethods(rawList) {
  const methods = rawList
    .map((item) => toMethodEntry(item))
    .filter(Boolean);
  const seen = new Set();
  return methods.filter((method) => {
    if (seen.has(method.type)) return false;
    seen.add(method.type);
    return true;
  });
}

async function fetchYipayPaymentMethods(paymentSettings) {
  if (!paymentSettings?.gateway_url || !paymentSettings?.merchant_id) {
    return { methods: [], error: 'missing_settings' };
  }

  const { mapiUrl } = getGatewayEndpoints(paymentSettings.gateway_url);
  if (!mapiUrl) return { methods: [], error: 'missing_gateway' };

  const requestUrl = new URL(mapiUrl);
  requestUrl.searchParams.set('act', 'paytype');
  requestUrl.searchParams.set('pid', paymentSettings.merchant_id);

  try {
    const response = await fetch(requestUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    const text = await response.text();
    const rawList = parsePaymentResponse(text);
    const methods = normalizePaymentMethods(rawList);
    if (methods.length > 0) {
      return { methods, error: null };
    }
    return { methods: DEFAULT_PAYMENT_METHODS, error: 'empty' };
  } catch (e) {
    return { methods: DEFAULT_PAYMENT_METHODS, error: e.message || 'request_failed' };
  }
}

module.exports = {
  DEFAULT_PAYMENT_METHODS,
  PAYMENT_LABELS,
  buildMd5,
  buildYipaySign,
  normalizePaymentType,
  getGatewayEndpoints,
  fetchYipayPaymentMethods,
};
