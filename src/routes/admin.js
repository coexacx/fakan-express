const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');
const {
  adminListProducts,
  adminGetProduct,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminImportCardKeys,
  adminInventoryStats,
} = require('../services/productService');
const {
  listOrdersAdmin,
  getOrderAdmin,
  markPaidAndDeliver,
  cancelOrder,
  formatMoney,
} = require('../services/orderService');
const {
  findAdminByUsername,
  verifyAdminPassword,
  updateAdminCredentials,
} = require('../services/adminService');

const router = express.Router();

// ---- Auth ----
router.get('/login', (req, res) => {
  res.render('admin/login', { title: '商家登录' });
});

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    req.session.flash = { type: 'danger', message: '请输入账号与密码' };
    return res.redirect('/admin/login');
  }

  const admin = await findAdminByUsername(username);
  if (!admin) {
    req.session.flash = { type: 'danger', message: '账号或密码错误' };
    return res.redirect('/admin/login');
  }

  const ok = await verifyAdminPassword(admin, password);
  if (!ok) {
    req.session.flash = { type: 'danger', message: '账号或密码错误' };
    return res.redirect('/admin/login');
  }

  req.session.admin = { id: admin.id, username: admin.username };
  req.session.flash = { type: 'success', message: '登录成功' };
  return res.redirect('/admin');
});

router.post('/logout', requireAdmin, (req, res) => {
  req.session.admin = null;
  req.session.flash = { type: 'success', message: '已退出登录' };
  return res.redirect('/admin/login');
});

// ---- Security ----
router.get('/security', requireAdmin, (req, res) => {
  res.render('admin/security', { title: '安全设置' });
});

router.post('/security', requireAdmin, async (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const username = String(req.body.username || '').trim();
  const newPassword = String(req.body.new_password || '');
  const confirmPassword = String(req.body.confirm_password || '');

  if (!currentPassword || !username || !newPassword) {
    req.session.flash = { type: 'danger', message: '请完整填写账号与密码' };
    return res.redirect('/admin/security');
  }

  if (newPassword !== confirmPassword) {
    req.session.flash = { type: 'danger', message: '两次输入的新密码不一致' };
    return res.redirect('/admin/security');
  }

  const admin = await findAdminByUsername(req.session.admin.username);
  if (!admin) {
    req.session.flash = { type: 'danger', message: '管理员信息不存在' };
    return res.redirect('/admin/security');
  }

  const ok = await verifyAdminPassword(admin, currentPassword);
  if (!ok) {
    req.session.flash = { type: 'danger', message: '当前密码不正确' };
    return res.redirect('/admin/security');
  }

  try {
    const updated = await updateAdminCredentials(admin.id, { username, password: newPassword });
    req.session.admin.username = updated.username;
    req.session.flash = { type: 'success', message: '账号与密码已更新' };
    return res.redirect('/admin/security');
  } catch (e) {
    const message = e.code === '23505' ? '该账号已存在' : (e.message || '更新失败');
    req.session.flash = { type: 'danger', message };
    return res.redirect('/admin/security');
  }
});

// ---- Dashboard ----
router.get('/', requireAdmin, async (req, res) => {
  const [{ rows: prodRows }, { rows: keyRows }, { rows: pendingRows }] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS c FROM products'),
    pool.query("SELECT COUNT(*)::int AS c FROM card_keys WHERE status='available'"),
    pool.query("SELECT COUNT(*)::int AS c FROM orders WHERE status IN ('pending','paid','delivery_failed')"),
  ]);

  res.render('admin/dashboard', {
    title: '后台管理',
    stats: {
      products: prodRows[0].c,
      availableKeys: keyRows[0].c,
      openOrders: pendingRows[0].c,
    },
  });
});

// ---- Products ----
router.get('/products', requireAdmin, async (req, res) => {
  const products = await adminListProducts();
  res.render('admin/products', { title: '商品管理', products, formatMoney });
});

router.get('/products/new', requireAdmin, async (req, res) => {
  res.render('admin/product_form', { title: '新增商品', product: null });
});

router.post('/products/new', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    const priceYuan = Number(req.body.price_yuan || 0);
    const is_active = req.body.is_active === 'on';

    if (!name) throw new Error('商品名称不能为空');
    if (!Number.isFinite(priceYuan) || priceYuan < 0) throw new Error('价格不正确');

    const price_cents = Math.round(priceYuan * 100);
    await adminCreateProduct({ name, description, price_cents, is_active });

    req.session.flash = { type: 'success', message: '商品已创建' };
    return res.redirect('/admin/products');
  } catch (e) {
    req.session.flash = { type: 'danger', message: e.message || '创建失败' };
    return res.redirect('/admin/products/new');
  }
});

router.get('/products/:id/edit', requireAdmin, async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);
  const product = await adminGetProduct(productId);
  if (!product) return res.status(404).send('Not found');

  res.render('admin/product_form', { title: '编辑商品', product });
});

router.post('/products/:id/edit', requireAdmin, async (req, res) => {
  try {
    const productId = Number.parseInt(req.params.id, 10);
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    const priceYuan = Number(req.body.price_yuan || 0);
    const is_active = req.body.is_active === 'on';

    if (!Number.isInteger(productId)) throw new Error('参数错误');
    if (!name) throw new Error('商品名称不能为空');
    if (!Number.isFinite(priceYuan) || priceYuan < 0) throw new Error('价格不正确');

    const price_cents = Math.round(priceYuan * 100);
    await adminUpdateProduct(productId, { name, description, price_cents, is_active });

    req.session.flash = { type: 'success', message: '商品已更新' };
    return res.redirect('/admin/products');
  } catch (e) {
    req.session.flash = { type: 'danger', message: e.message || '更新失败' };
    return res.redirect('back');
  }
});

router.post('/products/:id/delete', requireAdmin, async (req, res) => {
  try {
    const productId = Number.parseInt(req.params.id, 10);
    const result = await adminDeleteProduct(productId);
    req.session.flash = { type: 'success', message: result.message };
  } catch (e) {
    let message = e.message || '删除失败';
    if (e.code === '23503') {
      message = '删除失败：商品仍被订单或库存引用，请先清理关联数据';
    } else if (e.code === 'NOT_FOUND') {
      message = '商品不存在或已被删除';
    }
    req.session.flash = { type: 'danger', message };
  }
  return res.redirect('/admin/products');
});

// ---- Inventory ----
router.get('/products/:id/inventory', requireAdmin, async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);
  const product = await adminGetProduct(productId);
  if (!product) return res.status(404).send('Not found');

  const stats = await adminInventoryStats(productId);

  res.render('admin/inventory', { title: '库存管理', product, stats });
});

router.post('/products/:id/inventory/import', requireAdmin, async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);
  const product = await adminGetProduct(productId);
  if (!product) return res.status(404).send('Not found');

  const raw = String(req.body.codes || '');
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  // Remove duplicates in input
  const unique = Array.from(new Set(lines));

  try {
    const { inserted, skipped } = await adminImportCardKeys(productId, unique);
    req.session.flash = { type: 'success', message: `导入完成：新增 ${inserted} 条，跳过（重复）${skipped} 条` };
  } catch (e) {
    req.session.flash = { type: 'danger', message: e.message || '导入失败' };
  }

  return res.redirect(`/admin/products/${productId}/inventory`);
});

// ---- Orders ----
router.get('/orders', requireAdmin, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : '';
  const orders = await listOrdersAdmin({ status: status || null });
  res.render('admin/orders', { title: '订单管理', orders, formatMoney, status });
});

router.get('/orders/:orderNo', requireAdmin, async (req, res) => {
  const orderNo = req.params.orderNo;
  const data = await getOrderAdmin(orderNo);
  if (!data) return res.status(404).send('Not found');

  res.render('admin/order_detail', { title: '订单详情', data, formatMoney });
});

router.post('/orders/:orderNo/mark-paid', requireAdmin, async (req, res) => {
  const orderNo = req.params.orderNo;
  try {
    const out = await markPaidAndDeliver(orderNo, { force: true });
    req.session.flash = { type: out.status === 'delivered' ? 'success' : 'warning', message: out.message };
  } catch (e) {
    req.session.flash = { type: 'danger', message: e.message || '操作失败' };
  }
  return res.redirect(`/admin/orders/${encodeURIComponent(orderNo)}`);
});

router.post('/orders/:orderNo/cancel', requireAdmin, async (req, res) => {
  const orderNo = req.params.orderNo;
  try {
    await cancelOrder(orderNo);
    req.session.flash = { type: 'success', message: '订单已取消并释放库存' };
  } catch (e) {
    req.session.flash = { type: 'danger', message: e.message || '取消失败' };
  }
  return res.redirect(`/admin/orders/${encodeURIComponent(orderNo)}`);
});

module.exports = { adminRouter: router };
