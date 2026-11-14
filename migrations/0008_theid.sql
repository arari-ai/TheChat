CREATE TABLE theid_login_sessions(id TEXT PRIMARY KEY,member_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE theid_audit(id TEXT PRIMARY KEY,actor TEXT,action TEXT NOT NULL,target TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE theid_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,window_start INTEGER NOT NULL);
CREATE TABLE theid_identity_links(member_id TEXT PRIMARY KEY,issuer TEXT NOT NULL,subject TEXT NOT NULL,principal_revision INTEGER NOT NULL,grant_revision INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),current_binding INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX theid_identity_current_subject ON theid_identity_links(issuer,subject) WHERE current_binding=1;
CREATE TABLE theid_identity_sessions(session_id TEXT PRIMARY KEY REFERENCES theid_login_sessions(id) ON DELETE CASCADE,issuer TEXT NOT NULL,audience TEXT NOT NULL,subject TEXT NOT NULL,sid TEXT NOT NULL,local_member_id TEXT NOT NULL,principal_revision INTEGER NOT NULL,grant_revision INTEGER NOT NULL,checked_at INTEGER NOT NULL,valid_until INTEGER NOT NULL,auth_policy TEXT NOT NULL DEFAULT 'standard' CHECK(auth_policy IN ('standard','mfa')),assurance_until INTEGER NOT NULL DEFAULT 0);
CREATE INDEX theid_identity_session_sid ON theid_identity_sessions(issuer,sid);
CREATE TABLE theid_identity_transactions(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,verifier TEXT NOT NULL,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE theid_identity_inbox(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE theid_identity_logout(issuer TEXT NOT NULL,sid TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(issuer,sid));
CREATE TABLE theid_identity_assert(ok INTEGER CHECK(ok=1));

CREATE TABLE theid_identity_subjects(issuer TEXT NOT NULL,subject TEXT NOT NULL,member_id TEXT,principal_revision INTEGER NOT NULL,grant_revision INTEGER NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(issuer,subject));
