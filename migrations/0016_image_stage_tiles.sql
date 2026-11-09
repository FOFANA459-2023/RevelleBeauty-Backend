-- 0016 — a large square tile for the product page's gallery.
--
-- 0014 gave cards a square, trimmed tile; the product page still slid through
-- the original photographs, which come in every shape and are mostly empty
-- backdrop, so a wide shot in the square-ish stage showed bands of mat around a
-- small product. storage_path_lg holds the same recipe at stage size.
--
-- Nullable: rows without one (admin uploads, rows from before) fall back to
-- the original at storage_path.

alter table product_images add column if not exists storage_path_lg text;

comment on column product_images.storage_path_lg is
  'Square stage tile (~1200px): product trimmed and centred. Null means fall back to storage_path.';
