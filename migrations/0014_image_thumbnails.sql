-- 0014 — a card-sized derivative for every photograph.
--
-- Photographs are stored at 1600px for the product page, where someone is
-- looking closely. A grid card paints the same file into roughly 300 CSS px,
-- so a shop page was downloading several megapixels per card to throw almost
-- all of them away — and the card's hover reel multiplies that by four.
--
-- storage_path_sm holds a ~640px webp of the same source. It is nullable on
-- purpose: rows imported before this have none, and the API falls back to the
-- full-size path, so nothing breaks while the importer backfills.

alter table product_images add column if not exists storage_path_sm text;

comment on column product_images.storage_path_sm is
  'Card-sized (~640px) webp derivative. Null means none yet — fall back to storage_path.';
