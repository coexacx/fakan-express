const { pool, tx } = require('../db');
const { decryptText, encryptText, sha256Hex } = require('../crypto');

async function listActiveProducts() {
  const { rows } = await pool.query(
    `
    SELECT
      p.*,
      COALESCE((
        SELECT COUNT(*) FROM card_keys ck
        WHERE ck.product_id = p.id AND ck.status = 'available'
      ), 0)::int AS available_count
    FROM products p
    WHERE p.is_active = TRUE
    ORDER BY p.id DESC
    `
  );
  return rows;
}

async function getProductPublic(productId) {
  const { rows } = await pool.query(
    `
    SELECT
      p.*,
      COALESCE((
        SELECT COUNT(*) FROM card_keys ck
        WHERE ck.product_id = p.id AND ck.status = 'available'
      ), 0)::int AS available_count
    FROM products p
    WHERE p.id = $1 AND p.is_active = TRUE
    `,
    [productId]
  );
  return rows[0] || null;
}

async function adminListProducts() {
  const { rows } = await pool.query(
    `
    SELECT
      p.*,
      COALESCE((
        SELECT COUNT(*) FROM card_keys ck
        WHERE ck.product_id = p.id AND ck.status = 'available'
      ), 0)::int AS available_count,
      COALESCE((
        SELECT COUNT(*) FROM card_keys ck
        WHERE ck.product_id = p.id AND ck.status = 'reserved'
      ), 0)::int AS reserved_count,
      COALESCE((
        SELECT COUNT(*) FROM card_keys ck
        WHERE ck.product_id = p.id AND ck.status = 'sold'
      ), 0)::int AS sold_count
    FROM products p
    ORDER BY p.id DESC
    `
  );
  return rows;
}

async function adminGetProduct(productId) {
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);
  return rows[0] || null;
}

async function adminCreateProduct({ name, description, image_url, price_cents, is_active }) {
  const { rows } = await pool.query(
    `
    INSERT INTO products (name, description, image_url, price_cents, is_active, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    RETURNING *
    `,
    [name, description || null, image_url || null, price_cents, is_active]
  );
  return rows[0];
}

async function adminUpdateProduct(productId, { name, description, image_url, price_cents, is_active }) {
  const { rows } = await pool.query(
    `
    UPDATE products
    SET name = $2,
        description = $3,
        image_url = $4,
        price_cents = $5,
        is_active = $6,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [productId, name, description || null, image_url || null, price_cents, is_active]
  );
  return rows[0] || null;
}

async function adminDeleteProduct(productId) {
  return tx(async (client) => {
    await client.query('DELETE FROM card_keys WHERE product_id = $1', [productId]);
    await client.query('DELETE FROM order_items WHERE product_id = $1', [productId]);

    const { rowCount } = await client.query('DELETE FROM products WHERE id = $1', [productId]);
    if (rowCount === 0) {
      const err = new Error('商品不存在或已删除');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return { status: 'deleted', message: '商品已删除，关联库存与订单明细已同步清理' };
  });
}

async function adminSetProductActive(productId, is_active) {
  const { rows } = await pool.query(
    `
    UPDATE products
    SET is_active = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [productId, is_active]
  );
  return rows[0] || null;
}

async function adminImportCardKeys(productId, codes) {
  // codes: array of plaintext codes (already trimmed & non-empty)
  return tx(async (client) => {
    let inserted = 0;
    let skipped = 0;

    for (const code of codes) {
      const code_sha256 = sha256Hex(code);
      const code_encrypted = encryptText(code);

      const res = await client.query(
        `
        INSERT INTO card_keys (product_id, code_encrypted, code_sha256, status, created_at)
        VALUES ($1, $2, $3, 'available', NOW())
        ON CONFLICT (product_id, code_sha256) DO NOTHING
        `,
        [productId, code_encrypted, code_sha256]
      );

      if (res.rowCount === 1) inserted += 1;
      else skipped += 1;
    }

    return { inserted, skipped };
  });
}

async function adminInventoryStats(productId) {
  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN status='available' THEN 1 ELSE 0 END),0)::int AS available,
      COALESCE(SUM(CASE WHEN status='reserved' THEN 1 ELSE 0 END),0)::int AS reserved,
      COALESCE(SUM(CASE WHEN status='sold' THEN 1 ELSE 0 END),0)::int AS sold
    FROM card_keys
    WHERE product_id = $1
    `,
    [productId]
  );
  return rows[0] || { available: 0, reserved: 0, sold: 0 };
}

async function adminListCardKeys({ productId, status }) {
  const { rows } = await pool.query(
    `
    SELECT id, product_id, code_encrypted, status, sold_at, created_at
    FROM card_keys
    WHERE product_id = $1 AND status = $2
    ORDER BY id DESC
    `,
    [productId, status]
  );

  return rows.map((row) => ({
    ...row,
    code_plain: decryptText(row.code_encrypted),
  }));
}

async function adminGetCardKey(cardKeyId) {
  const { rows } = await pool.query(
    `
    SELECT id, product_id, code_encrypted, status
    FROM card_keys
    WHERE id = $1
    `,
    [cardKeyId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    code_plain: decryptText(row.code_encrypted),
  };
}

async function adminUpdateCardKey(cardKeyId, code) {
  const code_sha256 = sha256Hex(code);
  const code_encrypted = encryptText(code);

  const { rows } = await pool.query(
    `
    UPDATE card_keys
    SET code_encrypted = $1,
        code_sha256 = $2
    WHERE id = $3 AND status = 'available'
    RETURNING id, product_id
    `,
    [code_encrypted, code_sha256, cardKeyId]
  );

  if (!rows[0]) {
    const err = new Error('卡密不存在或已售出');
    err.code = 'NOT_EDITABLE';
    throw err;
  }

  return rows[0];
}

async function adminDeleteCardKey(cardKeyId) {
  const { rows } = await pool.query(
    `
    DELETE FROM card_keys
    WHERE id = $1 AND status = 'available'
    RETURNING id, product_id
    `,
    [cardKeyId]
  );

  if (!rows[0]) {
    const err = new Error('卡密不存在或已售出');
    err.code = 'NOT_EDITABLE';
    throw err;
  }

  return rows[0];
}

module.exports = {
  listActiveProducts,
  getProductPublic,
  adminListProducts,
  adminGetProduct,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminSetProductActive,
  adminImportCardKeys,
  adminInventoryStats,
  adminListCardKeys,
  adminGetCardKey,
  adminUpdateCardKey,
  adminDeleteCardKey,
};
