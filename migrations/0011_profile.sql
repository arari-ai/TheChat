CREATE TABLE theid_profiles(issuer TEXT NOT NULL,subject TEXT NOT NULL,member_id TEXT NOT NULL,revision INTEGER NOT NULL,name TEXT NOT NULL,PRIMARY KEY(issuer,subject));
CREATE TABLE theid_profile_inbox(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,created_at INTEGER NOT NULL);
