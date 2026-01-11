-- Update product foreign keys to cascade deletions
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE card_keys DROP CONSTRAINT IF EXISTS card_keys_product_id_fkey;
ALTER TABLE card_keys
  ADD CONSTRAINT card_keys_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
