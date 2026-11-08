import { Hono } from "hono";
import {
  sha256,
  spacesFor,
  canAccessChannel,
  sendMail,
  token,
  type Viewer
} from "./auth";
import { config, type Env } from "./env";
import { channelMailAddress } from "../shared/core";
export type CrmKind = "message" | "mail_in" | "mail_out";
type Message = {
  id: string;
  channel_id: string | null;
  thread_root_id: string | null;
  body: string;
  created_at: string;
  author_email: string | null;
  author_name: string | null;
  external_email: string | null;
  external_name: string | null;
  mail_subject: string | null;
};
export function buildCrmEvent(
  m: Message,
  kind: CrmKind,
  link: { deal_id: string },
  origin: string
) {
  if (!m.channel_id) throw Error("Direct messages cannot be exported");
  const email = (m.external_email || m.author_email || "").trim().toLowerCase();
  const url = new URL("/", origin);
  url.searchParams.set("channel", m.channel_id);
  if (m.thread_root_id) url.searchParams.set("thread", m.thread_root_id);
  return {
    source: kind === "message" ? "chat" : "mail",
    kind,
    external_id: `thechat:${m.channel_id}:${m.id}`,
    occurred_at: Date.parse(
      m.created_at.includes("T")
        ? m.created_at
        : m.created_at.replace(" ", "T") + "Z"
    ),
    emails: email ? [email] : [],
    deal_hint: link.deal_id,
    chat_channel_id: m.channel_id,
    title:
      kind === "message"
        ? `${m.external_name || m.author_name || "参加者"}: ${m.body.slice(0, 100)}`
        : m.mail_subject ||
          (kind === "mail_in" ? "メールを受信" : "メールを返信"),
    body: m.body.slice(0, 20000),
    url: url.toString()
  };
}
export async function crmTokenValid(
  header: string | undefined,
  secret: string | undefined
) {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  return (await sha256(header.slice(7))) === (await sha256(secret));
}
export async function deliverCrmEvent(
  env: Env,
  payload: unknown,
  fetcher: typeof fetch = fetch
): Promise<number> {
  if (!env.CRM_URL || !env.CRM_TOKEN) return 503;
  const origin = new URL(env.CRM_URL);
  if (origin.protocol !== "https:") return 503;
  try {
    const r = await fetcher(new URL("/api/ingest/events", origin).toString(), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.CRM_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
      redirect: "manual"
    });
    await r.arrayBuffer();
    return r.status;
  } catch {
    return 503;
  }
}
// Executed in the same D1 batch as the message insert. The queued snapshot is immutable.
export function crmOutboxStatement(
  env: Env,
  messageId: string,
  kind: CrmKind,
  customerEmail?: string
) {
  const origin = config(env).appOrigin;
  return env.DB.prepare(
    `INSERT OR IGNORE INTO crm_outbox(id,channel_id,deal_id,payload)
SELECT m.id,m.channel_id,l.deal_id,json_object('source',?,'kind',?,'external_id','thechat:'||m.channel_id||':'||m.id,'occurred_at',CAST(strftime('%s',m.created_at) AS INTEGER)*1000,'emails',json(CASE WHEN coalesce(?,m.external_email,u.email,'')='' THEN '[]' ELSE json_array(lower(trim(coalesce(?,m.external_email,u.email)))) END),'deal_hint',l.deal_id,'chat_channel_id',m.channel_id,'title',substr(CASE WHEN ?='message' THEN coalesce(m.external_name,u.name,'参加者')||': '||m.body ELSE coalesce(m.mail_subject,'メール') END,1,500),'body',substr(m.body,1,20000),'url',?||'/?channel='||m.channel_id||CASE WHEN m.thread_root_id IS NULL THEN '' ELSE '&thread='||m.thread_root_id END)
FROM messages m JOIN crm_channel_links l ON l.channel_id=m.channel_id LEFT JOIN users u ON u.id=m.author_id WHERE m.id=? AND m.dm_id IS NULL`
  ).bind(
    kind === "message" ? "chat" : "mail",
    kind,
    customerEmail || null,
    customerEmail || null,
    kind,
    origin || "",
    messageId
  );
}
export async function scheduleCrmDelivery(env: Env) {
  if (!env.CRM_URL || !env.CRM_TOKEN) return;
  try {
    await env.LIVE.get(env.LIVE.idFromName("__crm_delivery__")).fetch(
      "https://live/crm/ensure",
      { method: "POST" }
    );
  } catch {
    console.error("CRM delivery scheduling failed");
  }
}
export async function flushCrmOutbox(env: Env): Promise<number | null> {
  if (!env.CRM_URL || !env.CRM_TOKEN) return null;
  const now = Date.now();
  const pending = await env.DB.prepare(
    "SELECT * FROM crm_outbox WHERE delivered_at IS NULL AND cancelled_at IS NULL AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT 20"
  )
    .bind(now)
    .all<{
      id: string;
      channel_id: string;
      deal_id: string;
      payload: string;
      attempts: number;
    }>();
  for (const row of pending.results) {
    const current = await env.DB.prepare(
      "SELECT 1 FROM crm_channel_links l JOIN channels ch ON ch.id=l.channel_id JOIN spaces s ON s.id=ch.space_id WHERE l.channel_id=? AND l.deal_id=? AND ch.archived=0 AND s.archived=0"
    )
      .bind(row.channel_id, row.deal_id)
      .first();
    if (!current) {
      await env.DB.prepare("UPDATE crm_outbox SET cancelled_at=? WHERE id=?")
        .bind(now, row.id)
        .run();
      continue;
    }
    const status = await deliverCrmEvent(env, JSON.parse(row.payload));
    if (status >= 200 && status < 300)
      await env.DB.prepare(
        "UPDATE crm_outbox SET delivered_at=?,last_status=? WHERE id=?"
      )
        .bind(Date.now(), status, row.id)
        .run();
    else
      await env.DB.prepare(
        "UPDATE crm_outbox SET attempts=attempts+1,last_status=?,next_attempt_at=? WHERE id=?"
      )
        .bind(
          status,
          Date.now() +
            Math.min(3600000, 60000 * 2 ** Math.min(row.attempts, 6)),
          row.id
        )
        .run();
  }
  const next = await env.DB.prepare(
    "SELECT min(next_attempt_at) next FROM crm_outbox WHERE delivered_at IS NULL AND cancelled_at IS NULL"
  ).first<{ next: number | null }>();
  return next?.next == null ? null : Math.max(Date.now() + 1000, next.next);
}

export const crmApi = new Hono<{
  Bindings: Env;
  Variables: { crmActor: Viewer };
}>();
crmApi.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!(await crmTokenValid(c.req.header("Authorization"), c.env.CRM_TOKEN)))
    return c.json({ error: "Unauthorized" }, 401);
  await next();
});
crmApi.use("*", async (c, next) => {
  let actorEmail = c.req.header("X-CRM-Actor");
  if (c.req.method !== "GET") {
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({}) as Record<string, unknown>);
    actorEmail =
      typeof body.actor_email === "string" ? body.actor_email : undefined;
  }
  if (!actorEmail) return c.json({ error: "担当者が必要です" }, 400);
  const actor = await c.env.DB.prepare("SELECT * FROM users WHERE email=?")
    .bind(actorEmail.trim().toLowerCase())
    .first<Viewer>();
  if (!actor || actor.role === "guest")
    return c.json(
      { error: "TheChatのメンバーとしてログインできる担当者が必要です" },
      403
    );
  c.set("crmActor", actor);
  await next();
});
crmApi.get("/options", async (c) => {
  const ids = await spacesFor(c.env, c.get("crmActor"));
  if (!ids.length) return c.json({ spaces: [], channels: [] });
  const marks = ids.map(() => "?").join(",");
  const [spaces, channels] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id,name FROM spaces WHERE id IN (${marks}) ORDER BY name`
    )
      .bind(...ids)
      .all(),
    c.env.DB.prepare(
      `SELECT id,space_id,name,mail_address FROM channels WHERE archived=0 AND space_id IN (${marks}) ORDER BY name`
    )
      .bind(...ids)
      .all()
  ]);
  return c.json({ spaces: spaces.results, channels: channels.results });
});
crmApi.post("/link", async (c) => {
  const d = await c.req.json<any>(),
    actor = c.get("crmActor");
  for (const k of ["deal_id", "company_id", "company_name", "deal_title"])
    if (typeof d[k] !== "string" || !d[k].trim() || d[k].length > 500)
      return c.json({ error: "会社と案件の情報を確認してください" }, 400);
  const prior = await c.env.DB.prepare(
    "SELECT ch.id channel_id,ch.space_id,ch.mail_address FROM crm_channel_links l JOIN channels ch ON ch.id=l.channel_id WHERE l.deal_id=?"
  )
    .bind(d.deal_id)
    .first<any>();
  if (prior) {
    if (d.channel_id && d.channel_id !== prior.channel_id)
      return c.json(
        { error: "別のチャンネルが連携中です。先に連携を解除してください" },
        409
      );
    if (!(await canAccessChannel(c.env, actor, prior.channel_id)))
      return c.json({ error: "チャンネルにアクセスできません" }, 403);
    return c.json(prior);
  }
  let spaceId: string, channelId: string, address: string | null;
  const stmts: D1PreparedStatement[] = [];
  if (d.channel_id) {
    const ch = await canAccessChannel(c.env, actor, d.channel_id);
    if (!ch) return c.json({ error: "チャンネルにアクセスできません" }, 403);
    const used = await c.env.DB.prepare(
      "SELECT deal_id FROM crm_channel_links WHERE channel_id=?"
    )
      .bind(ch.id)
      .first();
    if (used)
      return c.json({ error: "このチャンネルは別の案件と連携しています" }, 409);
    spaceId = ch.space_id;
    channelId = ch.id;
    address = (await c.env.DB.prepare(
      "SELECT mail_address FROM channels WHERE id=?"
    )
      .bind(ch.id)
      .first<{ mail_address: string | null }>())!.mail_address;
  } else {
    const mapped = await c.env.DB.prepare(
      "SELECT space_id FROM crm_spaces WHERE company_id=?"
    )
      .bind(d.company_id)
      .first<{ space_id: string }>();
    spaceId = d.space_id || mapped?.space_id || crypto.randomUUID();
    const accessible = await spacesFor(c.env, actor);
    if (!d.space_id && !mapped) {
      if (actor.role !== "admin")
        return c.json(
          { error: "新しい会社スペースの作成はTheChat管理者が行ってください" },
          403
        );
      stmts.push(
        c.env.DB.prepare(
          "INSERT INTO spaces(id,name,all_members) VALUES (?,?,0)"
        ).bind(spaceId, d.company_name.slice(0, 80))
      );
    } else if (!accessible.includes(spaceId))
      return c.json({ error: "スペースにアクセスできません" }, 403);
    channelId = crypto.randomUUID();
    const cfg = config(c.env);
    address = cfg.domain
      ? channelMailAddress(channelId, cfg.domain, cfg.emailRouteAddress)
      : null;
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO channels(id,space_id,name,mail_address) VALUES (?,?,?,?)"
      ).bind(channelId, spaceId, d.deal_title.slice(0, 80), address)
    );
  }
  stmts.push(
    c.env.DB.prepare(
      "INSERT INTO crm_channel_links(channel_id,deal_id,company_id,linked_at) VALUES (?,?,?,?)"
    ).bind(channelId, d.deal_id, d.company_id, Date.now()),
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO crm_spaces(company_id,space_id) VALUES (?,?)"
    ).bind(d.company_id, spaceId)
  );
  try {
    await c.env.DB.batch(stmts);
  } catch {
    return c.json({ error: "連携が競合しました。再度お試しください" }, 409);
  }
  return c.json(
    { channel_id: channelId, space_id: spaceId, mail_address: address },
    201
  );
});
crmApi.post("/invite", async (c) => {
  const d = await c.req.json<any>();
  if (
    typeof d.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) ||
    d.email.length > 254 ||
    typeof d.deal_id !== "string"
  )
    return c.json({ error: "メールアドレスを確認してください" }, 400);
  const link = await c.env.DB.prepare(
    "SELECT l.channel_id,ch.space_id FROM crm_channel_links l JOIN channels ch ON ch.id=l.channel_id WHERE l.deal_id=?"
  )
    .bind(d.deal_id)
    .first<any>();
  if (
    !link ||
    !(await canAccessChannel(c.env, c.get("crmActor"), link.channel_id))
  )
    return c.json({ error: "チャンネルにアクセスできません" }, 403);
  const email = d.email.trim().toLowerCase(),
    existing = await c.env.DB.prepare(
      "SELECT u.id FROM users u JOIN space_members sm ON sm.user_id=u.id WHERE sm.space_id=? AND u.email=?"
    )
      .bind(link.space_id, email)
      .first();
  if (existing) return c.json({ ok: true, already_member: true });
  const inviteId = crypto.randomUUID(),
    secret = token();
  await c.env.DB.prepare(
    "INSERT INTO invitations(id,token_hash,email,role,space_id,expires_at) VALUES (?,?,?,'guest',?,?)"
  )
    .bind(
      inviteId,
      await sha256(secret),
      email,
      link.space_id,
      Date.now() + 604800000
    )
    .run();
  const origin = config(c.env).appOrigin;
  if (!origin) return c.json({ error: "公開URLが設定されていません" }, 503);
  try {
    await sendMail(
      c.env,
      email,
      "TheChatへの招待",
      `招待リンク: ${origin}/?invite=${encodeURIComponent(secret)}&email=${encodeURIComponent(email)}\n7日以内に開いてください。`
    );
  } catch {
    await c.env.DB.prepare("DELETE FROM invitations WHERE id=?")
      .bind(inviteId)
      .run();
    return c.json({ error: "招待メールを送信できませんでした" }, 503);
  }
  return c.json({ ok: true });
});
crmApi.post("/disconnect", async (c) => {
  const d = await c.req.json<any>();
  if (typeof d.deal_id !== "string")
    return c.json({ error: "案件が必要です" }, 400);
  const l = await c.env.DB.prepare(
    "SELECT channel_id FROM crm_channel_links WHERE deal_id=?"
  )
    .bind(d.deal_id)
    .first<{ channel_id: string }>();
  if (!l) return c.json({ ok: true });
  if (!(await canAccessChannel(c.env, c.get("crmActor"), l.channel_id)))
    return c.json({ error: "チャンネルにアクセスできません" }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM crm_channel_links WHERE deal_id=?").bind(
      d.deal_id
    ),
    c.env.DB.prepare(
      "UPDATE crm_outbox SET cancelled_at=? WHERE deal_id=? AND delivered_at IS NULL"
    ).bind(Date.now(), d.deal_id)
  ]);
  return c.json({ ok: true });
});
crmApi.get('/status',async c=>{const key=c.req.query('deal_id');if(!key||key.length>500)return c.json({error:'案件が必要です'},400);const link=await c.env.DB.prepare('SELECT channel_id FROM crm_channel_links WHERE deal_id=?').bind(key).first<{channel_id:string}>();if(!link)return c.json({linked:false,pending_count:0});if(!await canAccessChannel(c.env,c.get('crmActor'),link.channel_id))return c.json({error:'チャンネルにアクセスできません'},403);const pending=await c.env.DB.prepare('SELECT count(*) n FROM crm_outbox WHERE deal_id=? AND delivered_at IS NULL AND cancelled_at IS NULL').bind(key).first<{n:number}>();return c.json({linked:true,channel_id:link.channel_id,pending_count:pending?.n||0});});
