const { config } = require('../config');
const { tx, pool } = require('../db');
const { decryptText } = require('../crypto');
function pad2(n) {
  return String(n).padStart(2, '0');
}
function timestamp14(d = new Date()) {
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const da = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${y}${mo}${da}${hh}${mi}${ss}`; // 14位
}
function randDigits(len) {
  let s = '';
  for (let i = 0; i < len; i += 1) s += Math.floor(Math.random() * 10);
  return s;
}
function genNumeric18() {
  return `${timestamp14()}${randDigits(4)}`; // 18位：YYYYMMDDHHmmss + 4位随机
}

/**
 * Create a new order and reserve card keys immediately (to avoid overselling).
 * Public site has no login, so we give customer a secret access_token and use it in URL.
 */
async function createOrderAndReserve({ productId, qty, customerContact, customerNote }) {
  // Basic validation (keep it simple)
  if (!Number.isInteger(productId) || productId <= 0) throw new Error('商品参数错误');
  if (!Number.isInteger(qty) || qty <= 0 || qty > 100) throw new Error('购买数量错误（1-100）');
  if (!customerContact || String(customerContact).trim().length < 3) throw new Error('联系方式不能为空');
  customerContact = String(customerContact).trim().slice(0, 200);
  customerNote = customerNote ? String(customerNote).trim().slice(0, 500) : null;

  // Load product & price
  const { rows: prodRows } = await pool.query(
    'SELECT id, name, price_cents, is_active FROM products WHERE id = $1',
    [productId]
  );
  const product = prodRows[0];
  if (!product || !product.is_active) throw new Error('商品不存在或已下架');

  const unitPrice = Number(product.price_cents);
  const totalCents = unitPrice * qty;

  let orderNo;
  let accessToken;

// 极小概率同秒撞号，做个重试更稳
for (let i = 0; i < 5; i += 1) {
  orderNo = genNumeric18();
  accessToken = genNumeric18(); // token 也全数字同风格
  // 确保本次生成的两个值不一样（可选）
  if (accessToken !== orderNo) break;
}
  const reservedExpiresAt = new Date(Date.now() + config.reserveMinutes * 60 * 1000);

  return tx(async (client) => {
    const orderRes = await client.query(
      `
      INSERT INTO orders
        (order_no, access_token, customer_contact, customer_note, status, total_cents, reserved_expires_at, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, 'pending', $5, $6, NOW(), NOW())
      RETURNING id, order_no, access_token, status, total_cents, reserved_expires_at, created_at
      `,
      [orderNo, accessToken, customerContact, customerNote, totalCents, reservedExpiresAt]
    );
    const order = orderRes.rows[0];

    await client.query(
      `
      INSERT INTO order_items (order_id, product_id, qty, unit_price_cents, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      `,
      [order.id, productId, qty, unitPrice]
    );

    // Reserve keys
    const keyRows = await client.query(
      `
      SELECT id
      FROM card_keys
      WHERE product_id = $1 AND status = 'available'
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $2
      `,
      [productId, qty]
    );

    if (keyRows.rows.length < qty) {
      throw new Error('库存不足，请减少数量或稍后再试');
    }

    const keyIds = keyRows.rows.map((r) => r.id);
    await client.query(
      `
      UPDATE card_keys
      SET status = 'reserved', order_id = $1, reserved_until = $2
      WHERE id = ANY($3::bigint[])
      `,
      [order.id, reservedExpiresAt, keyIds]
    );

    return {
      orderNo: order.order_no,
      accessToken: order.access_token,
      reservedExpiresAt: order.reserved_expires_at,
      totalCents: order.total_cents,
    };
  });
}

async function getOrderForPublic({ orderNo, accessToken }) {
  const { rows: orderRows } = await pool.query(
    `
    SELECT *
    FROM orders
    WHERE order_no = $1 AND access_token = $2
    `,
    [orderNo, accessToken]
  );
  const order = orderRows[0] || null;
  if (!order) return null;

  const { rows: itemRows } = await pool.query(
    `
    SELECT oi.*, p.name AS product_name
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = $1
    `,
    [order.id]
  );

  const { rows: keyRows } = await pool.query(
    `
    SELECT id, product_id, code_encrypted, status
    FROM card_keys
    WHERE order_id = $1 AND status = 'sold'
    ORDER BY id ASC
    `,
    [order.id]
  );

  const deliveredCodes = keyRows.map((r) => {
    try {
      return decryptText(r.code_encrypted);
    } catch (e) {
      return '[解密失败]';
    }
  });

  return { order, items: itemRows, deliveredCodes };
}

async function getOrderAccessToken(orderNo) {
  const { rows } = await pool.query(
    `
    SELECT order_no, access_token
    FROM orders
    WHERE order_no = $1
    `,
    [orderNo]
  );
  return rows[0] || null;
}

async function lookupOrdersPublic({ orderNo, customerContact }) {
  orderNo = orderNo ? String(orderNo).trim() : '';
  customerContact = customerContact ? String(customerContact).trim() : '';

  let orders = [];

  if (orderNo) {
    const { rows } = await pool.query(`SELECT * FROM orders WHERE order_no=$1 LIMIT 1`, [orderNo]);
    if (rows[0]) orders = [rows[0]];
  } else {
    if (customerContact.length < 3) return [];
    // 精确匹配（更安全）；如果你想模糊匹配，把 = 改成 ILIKE 并传 %...%
    const { rows } = await pool.query(
      `SELECT * FROM orders WHERE customer_contact=$1 ORDER BY id DESC LIMIT 20`,
      [customerContact]
    );
    orders = rows;
  }

  const out = [];
  for (const order of orders) {
    const { rows: itemRows } = await pool.query(
      `
      SELECT oi.*, p.name AS product_name
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
      `,
      [order.id]
    );

    const { rows: keyRows } = await pool.query(
      `
      SELECT code_encrypted
      FROM card_keys
      WHERE order_id=$1 AND status='sold'
      ORDER BY id ASC
      `,
      [order.id]
    );

    const deliveredCodes = keyRows.map((r) => {
      try { return decryptText(r.code_encrypted); } catch { return '[解密失败]'; }
    });

    out.push({ order, items: itemRows, deliveredCodes });
  }

  return out;
}


async function listOrdersAdmin({ status, query }) {
  const params = [];
  const conditions = [];
  if (status) {
    params.push(status);
    conditions.push(`o.status = $${params.length}`);
  }
  if (query) {
    params.push(`%${query}%`);
    const placeholder = `$${params.length}`;
    conditions.push(`(o.order_no ILIKE ${placeholder} OR o.customer_contact ILIKE ${placeholder})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `
    SELECT o.*,
      (SELECT SUM(qty)::int FROM order_items WHERE order_id=o.id) AS total_qty
    FROM orders o
    ${where}
    ORDER BY o.id DESC
    LIMIT 200
    `,
    params
  );
  return rows;
}

async function getOrderAdmin(orderNo) {
  const { rows: orderRows } = await pool.query(
    'SELECT * FROM orders WHERE order_no = $1',
    [orderNo]
  );
  const order = orderRows[0] || null;
  if (!order) return null;

  const { rows: itemRows } = await pool.query(
    `
    SELECT oi.*, p.name AS product_name
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = $1
    `,
    [order.id]
  );

  const { rows: reservedRows } = await pool.query(
    `
    SELECT id, product_id, status, reserved_until
    FROM card_keys
    WHERE order_id = $1 AND status = 'reserved'
    ORDER BY id ASC
    `,
    [order.id]
  );

  const { rows: soldRows } = await pool.query(
    `
    SELECT id, product_id, status, sold_at, code_encrypted
    FROM card_keys
    WHERE order_id = $1 AND status = 'sold'
    ORDER BY id ASC
    `,
    [order.id]
  );

  const soldCodes = soldRows.map((r) => {
    try {
      return decryptText(r.code_encrypted);
    } catch (e) {
      return '[解密失败]';
    }
  });

  return { order, items: itemRows, reservedKeys: reservedRows, soldCodes };
}

/**
 * Mark order as paid and deliver card keys.
 * - Normal flow (force=false): only if not expired.
 * - Admin force flow (force=true): if expired, try to allocate new keys and deliver.
 */
async function markPaidAndDeliver(orderNo, { force = false } = {}) {
  if (!orderNo) throw new Error('orderNo required');

  return tx(async (client) => {
    const { rows: orderRows } = await client.query(
      `
      SELECT * FROM orders
      WHERE order_no = $1
      FOR UPDATE
      `,
      [orderNo]
    );
    const order = orderRows[0];
    if (!order) throw new Error('订单不存在');

    if (order.status === 'delivered') {
      return { status: 'delivered', message: '订单已发货（幂等处理）' };
    }
    if (order.status === 'canceled') {
      throw new Error('订单已取消，无法支付');
    }
    if (order.status === 'expired' && !force) {
      return { status: 'expired', message: '订单已过期，请重新下单' };
    }

    const now = new Date();

    const { rows: itemRows } = await client.query(
      'SELECT product_id, qty, unit_price_cents FROM order_items WHERE order_id = $1',
      [order.id]
    );
    if (itemRows.length === 0) throw new Error('订单明细异常');

    // If expired and not forced: expire and release
    if (order.status === 'pending' && order.reserved_expires_at && new Date(order.reserved_expires_at) < now && !force) {
      await client.query(
        `UPDATE orders SET status='expired', updated_at=NOW() WHERE id=$1`,
        [order.id]
      );
      await client.query(
        `
        UPDATE card_keys
        SET status='available', order_id=NULL, reserved_until=NULL
        WHERE order_id=$1 AND status='reserved'
        `,
        [order.id]
      );
      return { status: 'expired', message: '订单已超时未支付，已释放库存，请重新下单' };
    }

    // Always mark paid timestamp if not set
    await client.query(
      `
      UPDATE orders
      SET status = 'paid',
          paid_at = COALESCE(paid_at, NOW()),
          updated_at = NOW()
      WHERE id = $1
      `,
      [order.id]
    );

    // 1) Convert reserved keys to sold
    await client.query(
      `
      UPDATE card_keys
      SET status='sold', reserved_until=NULL, sold_at=NOW()
      WHERE order_id=$1 AND status='reserved'
      `,
      [order.id]
    );

    // 2) Ensure we have enough sold keys per product (in case order was forced after expiry)
    for (const item of itemRows) {
      const productId = Number(item.product_id);
      const needQty = Number(item.qty);

      const { rows: soldCountRows } = await client.query(
        `
        SELECT COUNT(*)::int AS c
        FROM card_keys
        WHERE order_id=$1 AND status='sold' AND product_id=$2
        `,
        [order.id, productId]
      );
      const soldCount = soldCountRows[0].c;

      const missing = needQty - soldCount;
      if (missing > 0) {
        // Release any previously reserved keys (shouldn't happen) and allocate fresh available keys
        const { rows: keyRows } = await client.query(
          `
          SELECT id
          FROM card_keys
          WHERE product_id=$1 AND status='available'
          ORDER BY id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $2
          `,
          [productId, missing]
        );

        if (keyRows.length < missing) {
          await client.query(
            `UPDATE orders SET status='delivery_failed', updated_at=NOW() WHERE id=$1`,
            [order.id]
          );
          return { status: 'delivery_failed', message: '已支付但库存不足，发货失败，请联系商家处理' };
        }

        const keyIds = keyRows.map((r) => r.id);
        await client.query(
          `
          UPDATE card_keys
          SET status='sold', order_id=$1, reserved_until=NULL, sold_at=NOW()
          WHERE id = ANY($2::bigint[])
          `,
          [order.id, keyIds]
        );
      }
    }

    await client.query(
      `
      UPDATE orders
      SET status='delivered', delivered_at=NOW(), updated_at=NOW()
      WHERE id=$1
      `,
      [order.id]
    );

    return { status: 'delivered', message: '支付成功，已自动发货' };
  });
}

async function cancelOrder(orderNo) {
  return tx(async (client) => {
    const { rows: orderRows } = await client.query(
      'SELECT * FROM orders WHERE order_no=$1 FOR UPDATE',
      [orderNo]
    );
    const order = orderRows[0];
    if (!order) throw new Error('订单不存在');

    if (order.status === 'delivered') throw new Error('已发货订单不能取消');
    if (order.status === 'canceled') return { ok: true };

    await client.query(
      `UPDATE orders SET status='canceled', updated_at=NOW() WHERE id=$1`,
      [order.id]
    );
    await client.query(
      `
      UPDATE card_keys
      SET status='available', order_id=NULL, reserved_until=NULL
      WHERE order_id=$1 AND status='reserved'
      `,
      [order.id]
    );

    return { ok: true };
  });
}

async function releaseExpiredReservations() {
  // Release reserved keys that have expired
  await pool.query(
    `
    UPDATE card_keys
    SET status='available', order_id=NULL, reserved_until=NULL
    WHERE status='reserved' AND reserved_until < NOW()
    `
  );

  // Mark orders expired (best-effort)
  await pool.query(
    `
    UPDATE orders
    SET status='expired', updated_at=NOW()
    WHERE status='pending' AND reserved_expires_at < NOW()
    `
  );
}

function formatMoney(cents) {
  const v = Number(cents || 0) / 100;
  return v.toFixed(2);
}

module.exports = {
  createOrderAndReserve,
  getOrderForPublic,
  listOrdersAdmin,
  getOrderAdmin,
  markPaidAndDeliver,
  cancelOrder,
  releaseExpiredReservations,
  formatMoney,
  lookupOrdersPublic,
  getOrderAccessToken,
};
