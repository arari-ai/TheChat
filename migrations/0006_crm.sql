-- Only explicitly linked channels are exported; DMs and existing history are not queued.
CREATE TABLE crm_spaces(company_id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id));
CREATE TABLE crm_channel_links(channel_id TEXT PRIMARY KEY REFERENCES channels(id),deal_id TEXT NOT NULL UNIQUE,company_id TEXT NOT NULL,linked_at INTEGER NOT NULL);
CREATE TABLE crm_outbox(id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,deal_id TEXT NOT NULL,payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,last_status INTEGER,delivered_at INTEGER,cancelled_at INTEGER);
CREATE INDEX crm_outbox_pending ON crm_outbox(delivered_at,cancelled_at,next_attempt_at);
