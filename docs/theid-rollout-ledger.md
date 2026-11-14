# TheChat optional SSO execution ledger

Plan: ../docs/superpowers/plans/2026-11-14-chat-sso.md in enclosing ARARI workspace; approved suite SSO spec. Isolated workspace clone, feature branch.

Interfaces: SDK0.1.2 must return hashed context, preserve native IDs and exact revocation/MFA. Native external classification comes only from database role; no permission inheritance. DO repeats credential selection, so actual object ID must match selected account. No new alarms.

Complete: authentication/guest/old-email-code tests observed RED (missing identity module/APIs); GREEN native role preservation/standalone, unmanaged guest partial/oidc, mapped/tombstoned guests and staff, local logout contexts. SDK full54 tests/type/build separately pass, fresh chat_sdk_review no findings, TheID PR5 merged.
Complete: real Worker/D1/DO broadcast data gate, native logout ping, same-origin handshake; observed initial RED unauthorized private data/close behavior. Broadcast close may remain CLOSING waiting on peer; test checks no open server socket and no output after stop. Native heartbeat tests verify4001. Client periodic30s ping and cleanup observed RED then GREEN.
Complete: UI employee/guest split and config worker-first routing/no-secret configuration observed RED then GREEN. Source full54 tests, typecheck, build and dryrun pass.
Review: fresh chat_sso_final_review found P1 credentials changing between outer/inner check could route another principal into wrong DO. Reproduced realDO upgrade101 vs expected401. Fixed by comparing actual ctx.id with namespace.idFromName(current native account ID); full54 tests/check/build/dryrun GREEN; reviewer followup confirms resolved and no other blockers. Private deployment overlay also reviewed, preserves opaque config and resources.
Deployment pending: common source merge, company pinned source+local overlay rollout first. Then exact client key/grant confirmation, user fresh proof if needed, activate hybrid and existing-ID mapping, production SSO/local logout. Do not call complete until production verified.
