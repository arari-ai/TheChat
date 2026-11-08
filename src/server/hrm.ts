import { Hono } from "hono";
import type { Env } from "./env";
import { config } from "./env";
export const hrmApi = new Hono<{ Bindings: Env }>();
async function digest(s: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
  );
}
hrmApi.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!c.env.HRM_TOKEN) return c.json({ error: "not_found" }, 404);
  const key = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!key) return c.json({ error: "unauthorized" }, 401);
  const [a, b] = await Promise.all([digest(key), digest(c.env.HRM_TOKEN)]);
  let d = 0;
  for (let i = 0; i < 32; i++) d |= a[i] ^ b[i];
  if (d) return c.json({ error: "unauthorized" }, 401);
  await next();
});
export async function changeAccount(env: Env, email: string, enable: boolean) {
  const user = await env.DB.prepare(
    "SELECT id,disabled_at FROM users WHERE lower(trim(email))=?",
  )
    .bind(email)
    .first<{ id: string; disabled_at: string | null }>();
  if (!user) return { result: "not_found" };
  if (enable) {
    if (user.disabled_at === null) return { result: "already_enabled" };
    await env.DB.prepare("UPDATE users SET disabled_at=NULL WHERE id=?")
      .bind(user.id)
      .run();
    return { result: "enabled" };
  }
  if (user.disabled_at !== null) return { result: "already_disabled" };
  const stamp = new Date().toISOString();
  const guard = "EXISTS(SELECT 1 FROM users WHERE id=?1 AND disabled_at=?2)";
  const result = await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET disabled_at=?2 WHERE id=?1 AND disabled_at IS NULL AND (role<>'admin' OR (SELECT count(*) FROM users WHERE role='admin' AND disabled_at IS NULL)>1)",
    ).bind(user.id, stamp),
    env.DB.prepare("DELETE FROM sessions WHERE user_id=?1 AND " + guard).bind(
      user.id,
      stamp,
    ),
    env.DB.prepare(
      "UPDATE invitations SET expires_at=0 WHERE lower(trim(email))=?3 AND accepted_at IS NULL AND " +
        guard,
    ).bind(user.id, stamp, email),
    env.DB.prepare("DELETE FROM login_codes WHERE email=?3 AND " + guard).bind(
      user.id,
      stamp,
      email,
    ),
    env.DB.prepare(
      "DELETE FROM push_subscriptions WHERE user_id=?1 AND " + guard,
    ).bind(user.id, stamp),
  ]);
  if (!result[0].meta.changes) {
    const current = await env.DB.prepare(
      "SELECT disabled_at FROM users WHERE id=?",
    )
      .bind(user.id)
      .first<{ disabled_at: string | null }>();
    return current?.disabled_at
      ? { result: "already_disabled" }
      : { error: "last_admin" };
  }
  try {
    await env.LIVE.get(env.LIVE.idFromName(user.id)).fetch(
      "https://live/revoke",
      { method: "POST" },
    );
  } catch {
    /* session checks and active-recipient filtering remain authoritative */
  }
  return { result: "disabled" };
}
hrmApi.get("/accounts", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT email,name,role,disabled_at FROM users WHERE role IN ('admin','member') ORDER BY email",
  ).all<{
    email: string;
    name: string;
    role: string;
    disabled_at: string | null;
  }>();
  return c.json({
    tool: "chat",
    accounts: rows.results.map((r) => ({
      email: r.email,
      name: r.name,
      role: r.role,
      active: r.disabled_at === null,
    })),
  });
});
hrmApi.get("/owned", async (c) => {
  const email = validEmail(c.req.query("email"));
  if (!email) return c.json({ error: "invalid_email" }, 400);
  const row = await c.env.DB.prepare(
    "SELECT count(*) n FROM message_addressees a JOIN users u ON u.id=a.user_id WHERE lower(trim(u.email))=? AND a.status='pending'",
  )
    .bind(email)
    .first<{ n: number }>();
  return c.json({
    items: row?.n
      ? [
          {
            kind: "pending_requests",
            label: "未対応の依頼",
            count: row.n,
            url: config(c.env).appOrigin || new URL(c.req.url).origin,
          },
        ]
      : [],
  });
});
export function validEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}
for (const action of ["disable", "enable"] as const)
  hrmApi.post("/" + action, async (c) => {
    const body = await c.req.json<{ email?: unknown }>().catch(() => null);
    const email = validEmail(body?.email);
    if (!email) return c.json({ error: "invalid_email" }, 400);
    const result = await changeAccount(c.env, email, action === "enable");
    return c.json(result, "error" in result ? 409 : 200);
  });
