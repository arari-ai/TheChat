-- Reset only historical app SSO sessions, never native or central TheID sessions.
DELETE FROM theid_login_sessions;
CREATE TRIGGER theid_native_disabled AFTER UPDATE OF disabled_at ON users
WHEN NEW.disabled_at IS NOT NULL
BEGIN DELETE FROM theid_login_sessions WHERE member_id=NEW.id; END;
CREATE TRIGGER theid_native_deleted AFTER DELETE ON users
BEGIN DELETE FROM theid_login_sessions WHERE member_id=OLD.id; END;
CREATE TRIGGER theid_native_session_eligible BEFORE INSERT ON theid_login_sessions
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.member_id AND disabled_at IS NULL)
BEGIN SELECT RAISE(ABORT,'Native identity inactive'); END;
