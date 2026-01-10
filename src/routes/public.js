const express = require('express');
const router = express.Router();

const { listActiveProducts, getProductPublic } = require('../services/productService');

const {
  createOrderAndReserve,
  getOrderForPublic,
  markPaidAndDeliver,
  formatMoney,
  lookupOrdersPublic,
} = require('../services/orderService');

const { config } = require('../config');
const { hmacSha256Hex, timingSafeEqual } = require('../crypto');

// 取出一次性 flash（用完即清）
function consumeFlash(req) {
  const flash = req.session ? req.session.flash : null;
  if (req.session) delete req.session.flash;
  return flash;
}

router.get('/', async (req, res) => {
  const products = await listActiveProducts();
  res.render('public/index', { title: '商品列表', products, formatMoney, flash: consumeFlash(req) });
});

router.get('/product/:id', async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(productId)) return res.status(404).send('Not found');

  const product = await getProductPublic(productId);
  if (!product) return res.status(404).send('商品不存在或已下架');

  res.render('public/product', { title: product.name, product, formatMoney, flash: consumeFlash(req) });
});

// 订单查询页
router.get('/query', async (req, res) => {
  res.render('public/query', {
    title: '订单查询',
    results: null,
    q: null,
    formatMoney,
    flash: consumeFlash(req),
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
    res.render('public/query', {
      title: '订单查询',
      results,
      q: { order_no: orderNo, customer_contact: customerContact },
      formatMoney,
      flash: consumeFlash(req),
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

  res.render('public/order', {
    title: `订单 ${orderNo}`,
    data,
    formatMoney,
    reserveMinutes: config.reserveMinutes,
    flash: consumeFlash(req),
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

  res.render('public/pay', { title: '支付', data, formatMoney, flash: consumeFlash(req) });
});

// Mock payment confirm (demo)
router.post('/pay/:orderNo/:token/confirm', async (req, res) => {
  const orderNo = req.params.orderNo;
  const token = req.params.token;

  const data = await getOrderForPublic({ orderNo, accessToken: token });
  if (!data) return res.status(404).send('订单不存在或访问凭证错误');

  if (data.order.status !== 'pending') {
    req.session.flash = { type: 'warning', message: `订单当前状态为 ${data.order.status}，无法进行演示支付` };
    return res.redirect(`/order/${encodeURIComponent(orderNo)}/${encodeURIComponent(token)}`);
  }

  try {
    const out = await markPaidAndDeliver(orderNo, { force: false });
    req.session.flash = { type: out.status === 'delivered' ? 'success' : 'warning', message: out.message };
  } catch (e) {
    req.session.flash = { type: 'danger', message: e.message || '支付处理失败' };
  }

  return res.redirect(`/order/${encodeURIComponent(orderNo)}/${encodeURIComponent(token)}`);
});

/**
 * Optional real payment webhook (HMAC-SHA256)
 * - Header: x-fakan-signature: <hex>
 * - Body: { "order_no": "...", "status": "success" }
 */
router.post('/webhook/payment', async (req, res) => {
  if (!config.paymentWebhookSecret) {
    return res.status(400).json({ ok: false, error: 'PAYMENT_WEBHOOK_SECRET not set' });
  }

  const signature = req.get('x-fakan-signature') || '';
  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const expected = hmacSha256Hex(config.paymentWebhookSecret, rawBody);

  if (!timingSafeEqual(signature, expected)) {
    return res.status(401).json({ ok: false, error: 'invalid signature' });
  }

  const { order_no, status } = req.body || {};
  if (!order_no) return res.status(400).json({ ok: false, error: 'order_no required' });

  if (status !== 'success') return res.json({ ok: true, ignored: true });

  try {
    const out = await markPaidAndDeliver(order_no, { force: true });
    return res.json({ ok: true, result: out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'failed' });
  }
});

module.exports = { publicRouter: router };
