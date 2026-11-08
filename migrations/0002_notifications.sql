ALTER TABLE events ADD COLUMN read_at INTEGER;
ALTER TABLE events ADD COLUMN emailed_at INTEGER;
ALTER TABLE events ADD COLUMN notifiable INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS message_mentions (message_id TEXT NOT NULL REFERENCES messages(id), user_id TEXT NOT NULL REFERENCES users(id), read_at INTEGER, PRIMARY KEY(message_id,user_id));
CREATE INDEX IF NOT EXISTS idx_mentions_user ON message_mentions(user_id,read_at);
