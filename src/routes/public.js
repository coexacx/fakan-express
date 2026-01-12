const express = require('express');
const router = express.Router();

const { listActiveProducts, getProductPublic } = require('../services/productService');
const { getSiteSettings } = require('../services/siteSettingsService');
const { getPaymentSettings } = require('../services/paymentSettingsService');
const {
  buildYipaySign,
  normalizePaymentType,
  getGatewayEndpoints,
  fetchYipayPaymentMethods,
} = require('../services/yipayService');

const {
  createOrderAndReserve,
  getOrderForPublic,
  markPaidAndDeliver,
  formatMoney,
  lookupOrdersPublic,
  getOrderAccessToken,
} = require('../services/orderService');

const { config } = require('../config');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function isPaymentReady(settings) {
  return Boolean(settings.gateway_url && settings.merchant_id && settings.merchant_key);
}

function verifyYipayCallback(params, settings) {
  const required = ['pid', 'trade_no', 'out_trade_no', 'type', 'name', 'money', 'trade_status'];
  if (!required.every((field) => params[field])) return false;
  const expected = buildYipaySign(params, settings.merchant_key, required);
  return String(params.sign || '').toLowerCase() === expected;
}

// 取出一次性 flash（用完即清）
function consumeFlash(req) {
  const flash = req.session ? req.session.flash : null;
  if (req.session) delete req.session.flash;
  return flash;
}

router.get('/', async (req, res) => {
  const products = await listActiveProducts();
  const siteSettings = await getSiteSettings();
  res.render('public/index', {
    title: '商品列表',
    products,
    formatMoney,
    flash: consumeFlash(req),
    siteSettings,
  });
});

router.get('/product/:id', async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(productId)) return res.status(404).send('Not found');

  const product = await getProductPublic(productId);
  if (!product) return res.status(404).send('商品不存在或已下架');

  const siteSettings = await getSiteSettings();
  res.render('public/product', {
    title: product.name,
    product,
    formatMoney,
    flash: consumeFlash(req),
    siteSettings,
  });
});

// 订单查询页
router.get('/query', async (req, res) => {
  const siteSettings = await getSiteSettings();
  res.render('public/query', {
    title: '订单查询',
    results: null,
    q: null,
    formatMoney,
    flash: consumeFlash(req),
    siteSettings,
  });
});

router.post('/query', async (req, res) => {
  const orderNo = (req.body.order_no || '').trim();
  const customerContact = (req.body.customer_contact || '').trim();

  if (!orderNo && !customerContact) {
    req.session.flash = { type: 'warning', message: '请输入订单号或下单联系方式任意一个' };
    return res.redirect('/query');
  }

  try {
    const results = await lookupOrdersPublic({ orderNo, customerContact });
    const siteSettings = await getSiteSettings();
    res.render('public/query', {
      title: '订单查询',
      results,
      q: { order_no: orderNo, customer_contact: customerContact },
      formatMoney,
      flash: consumeFlash(req),
      siteSettings,
    });
  } catch (e) {
    req.session.flash = { type: 'danger', message: e.message || '查询失败' };
    return res.redirect('/query');
  }
});

router.post('/order', async (req, res) => {
  try {
    const productId = Number.parseInt(req.body.product_id, 10);
    const qty = Number.parseInt(req.body.qty, 10);
    const customerContact = req.body.customer_contact;
    const customerNote = req.body.customer_note;

    const out = await createOrderAndReserve({ productId, qty, customerContact, customerNote });
    return res.redirect(`/order/${encodeURIComponent(out.orderNo)}/${encodeURIComponent(out.accessToken)}`);
  } catch (e) {
    req.session.flash = { type: 'danger', message: e.message || '下单失败' };
    return res.redirect('back');
  }
});

router.get('/order/:orderNo/:token', async (req, res) => {
  const orderNo = req.params.orderNo;
  const token = req.params.token;

  const data = await getOrderForPublic({ orderNo, accessToken: token });
  if (!data) return res.status(404).send('订单不存在或访问凭证错误');

  const siteSettings = await getSiteSettings();
  res.render('public/order', {
    title: `订单 ${orderNo}`,
    data,
    formatMoney,
    reserveMinutes: config.reserveMinutes,
    flash: consumeFlash(req),
    siteSettings,
  });
});

// Mock payment page
router.get('/pay/:orderNo/:token', async (req, res) => {
  const orderNo = req.params.orderNo;
  const token = req.params.token;

  const data = await getOrderForPublic({ orderNo, accessToken: token });
  if (!data) return res.status(404).send('订单不存在或访问凭证错误');

  if (data.order.status !== 'pending') {
    req.session.flash = { type: 'warning', message: `订单当前状态为 ${data.order.status}，无需支付` };
    return res.redirect(`/order/${encodeURIComponent(orderNo)}/${encodeURIComponent(token)}`);
  }

  const [siteSettings, paymentSettings] = await Promise.all([
    getSiteSettings(),
    getPaymentSettings(),
  ]);
  const { methods: paymentMethods } = await fetchYipayPaymentMethods(paymentSettings);
  res.render('public/pay', {
    title: '支付',
    data,
    formatMoney,
    flash: consumeFlash(req),
    siteSettings,
    paymentMethods,
    paymentReady: isPaymentReady(paymentSettings),
  });
});

// Create real payment order (YiPay)
router.post('/pay/:orderNo/:token', async (req, res) => {
  const orderNo = req.params.orderNo;
  const token = req.params.token;
  const paymentType = normalizePaymentType(req.body.type);

  const data = await getOrderForPublic({ orderNo, accessToken: token });
  if (!data) return res.status(404).send('订单不存在或访问凭证错误');

  if (data.order.status !== 'pending') {
    req.session.flash = { type: 'warning', message: `订单当前状态为 ${data.order.status}，无需支付` };
    return res.redirect(`/order/${encodeURIComponent(orderNo)}/${encodeURIComponent(token)}`);
  }

  if (!paymentType) {
    req.session.flash = { type: 'warning', message: '请选择支付方式' };
    return res.redirect(`/pay/${encodeURIComponent(orderNo)}/${encodeURIComponent(token)}`);
  }

  const paymentSettings = await getPaymentSettings();
  if (!isPaymentReady(paymentSettings)) {
    req.session.flash = { type: 'danger', message: '支付通道未配置，请联系商家' };
    return res.redirect(`/pay/${encodeURIComponent(orderNo)}/${encodeURIComponent(token)}`);
  }

  const { methods: availableMethods } = await fetchYipayPaymentMethods(paymentSettings);
  if (availableMethods.length > 0 && !availableMethods.some((method) => method.type === paymentType)) {
    req.session.flash = { type: 'warning', message: '当前支付方式不可用，请重新选择' };
    return res.redirect(`/pay/${encodeURIComponent(orderNo)}/${encodeURIComponent(token)}`);
  }

  const baseUrl = getBaseUrl(req);
  const { submitUrl } = getGatewayEndpoints(paymentSettings.gateway_url);
  const payload = {
    pid: paymentSettings.merchant_id,
    type: paymentType,
    out_trade_no: orderNo,
    notify_url: `${baseUrl}/pay/notify`,
    return_url: `${baseUrl}/pay/return`,
    name: `订单 ${orderNo}`,
    money: formatMoney(data.order.total_cents),
  };
  const sign = buildYipaySign(payload, paymentSettings.merchant_key, [
    'pid',
    'type',
    'out_trade_no',
    'notify_url',
    'return_url',
    'name',
    'money',
  ]);
  const formFields = {
    ...payload,
    sign,
    sign_type: 'MD5',
  };
  const inputs = Object.entries(formFields)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join('\n');

  return res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <title>正在跳转到支付...</title>
      </head>
      <body>
        <p>正在跳转到支付平台，请稍候...</p>
        <form id="pay-form" method="post" action="${escapeHtml(submitUrl || paymentSettings.gateway_url)}">
          ${inputs}
        </form>
        <script>
          document.getElementById('pay-form').submit();
        </script>
      </body>
    </html>
  `);
});

router.post('/pay/notify', async (req, res) => {
  const paymentSettings = await getPaymentSettings();
  if (!isPaymentReady(paymentSettings)) return res.status(400).send('fail');

  const payload = { ...req.query, ...req.body };
  if (!verifyYipayCallback(payload, paymentSettings)) return res.status(401).send('fail');

  const tradeStatus = String(payload.trade_status || '').toUpperCase();
  if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'SUCCESS') {
    return res.send('success');
  }

  try {
    await markPaidAndDeliver(payload.out_trade_no, { force: true });
    return res.send('success');
  } catch (e) {
    return res.status(500).send('fail');
  }
});

router.get('/pay/return', async (req, res) => {
  const paymentSettings = await getPaymentSettings();
  if (!isPaymentReady(paymentSettings)) {
    req.session.flash = { type: 'danger', message: '支付通道未配置，请联系商家' };
    return res.redirect('/query');
  }

  const payload = { ...req.query };
  if (!verifyYipayCallback(payload, paymentSettings)) {
    req.session.flash = { type: 'danger', message: '支付校验失败，请联系商家' };
    return res.redirect('/query');
  }

  const tradeStatus = String(payload.trade_status || '').toUpperCase();
  if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'SUCCESS') {
    try {
      await markPaidAndDeliver(payload.out_trade_no, { force: true });
      req.session.flash = { type: 'success', message: '支付成功，订单已处理' };
    } catch (e) {
      req.session.flash = { type: 'warning', message: e.message || '支付成功但处理失败，请联系商家' };
    }
  } else {
    req.session.flash = { type: 'warning', message: '支付未完成或状态异常' };
  }

  const orderAccess = await getOrderAccessToken(payload.out_trade_no);
  if (orderAccess) {
    return res.redirect(`/order/${encodeURIComponent(orderAccess.order_no)}/${encodeURIComponent(orderAccess.access_token)}`);
  }

  return res.redirect('/query');
});

module.exports = { publicRouter: router };
