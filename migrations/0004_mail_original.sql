CREATE TABLE IF NOT EXISTS mail_originals (message_id TEXT PRIMARY KEY REFERENCES messages(id), body TEXT NOT NULL);
