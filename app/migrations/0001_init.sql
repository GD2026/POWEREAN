-- D1 schema. Applied by the platform on deploy. ONE live database: keep every
-- change additive (CREATE TABLE IF NOT EXISTS / ADD COLUMN).

-- An EAN list. `id` is a random UUIDv4 and doubles as the access key, so a
-- list can be shared by link between a phone and the PC at the till.
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per EAN in a list, with a snapshot of the product so the list
-- renders without calling power.no again.
CREATE TABLE IF NOT EXISTS list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  ean TEXT NOT NULL,
  title TEXT,
  price REAL,
  thumb_url TEXT,
  product_url TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (list_id, ean)
);
CREATE INDEX IF NOT EXISTS list_items_by_list ON list_items (list_id, position);

-- Fixed-window request counter per hashed client IP, for the power.no proxy.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
