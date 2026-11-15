CREATE TABLE hrm_provision_accounts(source_id TEXT NOT NULL,person_id TEXT NOT NULL,generation INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('active','stopped')),native_id TEXT UNIQUE,identity_mode TEXT,identity_subject TEXT,role TEXT,identity_fingerprint TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(source_id,person_id));
CREATE TABLE hrm_provision_requests(request_id TEXT PRIMARY KEY,source_id TEXT NOT NULL,person_id TEXT NOT NULL,generation INTEGER NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE hrm_provision_assert(ok INTEGER CHECK(ok=1));

-- Persist the managed-login barrier in D1, including during a code rollback.
CREATE TRIGGER hrm_provision_native_claimed AFTER INSERT ON hrm_provision_accounts
WHEN NEW.native_id IS NOT NULL AND NEW.identity_mode='theid'
BEGIN
 DELETE FROM sessions WHERE user_id=NEW.native_id;
 DELETE FROM login_codes WHERE email=(SELECT email FROM users WHERE id=NEW.native_id);
END;
CREATE TRIGGER hrm_provision_native_session BEFORE INSERT ON sessions
WHEN EXISTS(SELECT 1 FROM hrm_provision_accounts p WHERE p.native_id=NEW.user_id AND (p.state='stopped' OR p.identity_mode='theid'))
BEGIN SELECT RAISE(ABORT,'Managed identity requires SSO'); END;
CREATE TRIGGER hrm_provision_native_code BEFORE INSERT ON login_codes
WHEN EXISTS(SELECT 1 FROM users a JOIN hrm_provision_accounts p ON p.native_id=a.id WHERE a.email=NEW.email COLLATE NOCASE AND (p.state='stopped' OR p.identity_mode='theid'))
BEGIN SELECT RAISE(ABORT,'Managed identity requires SSO'); END;
