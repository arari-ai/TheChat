# Message usability implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans; independent whole-branch review before integration.

**Goal:** Show latest posts on entry and allow authenticated authors to edit/delete their own posts without deleting replies.
**Architecture:** Existing D1 edited_at/deleted_at, scoped author API, sanitized tombstones and shared message controls. Scroll container preserves the visible anchor across reloads and older-page prepends.
**Tech Stack:** React, Hono, Cloudflare Workers/D1, existing Miniflare/Vitest.
**Spec:** ../specs/2026-11-16-message-usability-design.md

## Global constraints
No customer data/settings or secrets in public source. Preserve local/SSO authorization, CRM historical snapshots and native access rules. No physical message deletion. No dependency additions.

## Review focus
- Other authors/admins, removed/disabled users and cross-origin mutation requests cannot change posts.
- Deleted body and attachments must not leak through list, search, notifications or original-mail routes.
- Parent deletion keeps replies accessible and posting failures retain text.
- Older-page loads and live refresh while reading preserve position and loaded history.
- Channel switches and rapid responses must not show stale data or move another conversation.

### Task 1 — API and projection
Files: src/server/api.ts, test/message-mutations.test.ts. Use PATCH/DELETE /api/messages/:id; PATCH {body,expectedBody} body-only strict validation/CAS; delete own native post to tombstone. Keep replies; suppress deleted metadata/attachments; update FTS atomically and refresh current viewers without notification.
- [ ] Write real-D1 tests for ownership, access, validation, conflicts, deleted read routes and replies; run RED.
- [ ] Implement API and sanitized list projection; run GREEN and whole suite.

### Task 2 — controls and scroll
Files: src/client/app.tsx, src/client/MessageEditor.tsx, src/client/Timeline.tsx, src/client/api.ts, src/client/style.css, test/message-card.test.tsx, test/timeline.test.ts.
- [ ] Write failing control/scroll behavior tests.
- [ ] Add edit save/cancel/errors, delete confirmation, deleted placeholder, edited indicator; reusable timeline initial-bottom, near-bottom following and anchor restoration.
- [ ] Preserve pages on refresh and stale-request fences; refresh open thread root after mutations; check channel, DM and replies.

### Task 3 — validation and release
- [ ] npm test, npm run check, npm run build, wrangler deploy --dry-run.
- [ ] Test real local browser PC/mobile flows against disposable fixtures; independent security/usability review.
- [ ] Source PR/CI then company pin without config changes; actual deployment and public auth smoke verification.
