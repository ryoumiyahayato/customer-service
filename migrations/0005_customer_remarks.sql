CREATE TABLE IF NOT EXISTS customer_remarks (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  remark_name TEXT NOT NULL,
  updated_by TEXT REFERENCES admins(id),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_remarks_updated_at
ON customer_remarks(updated_at);
