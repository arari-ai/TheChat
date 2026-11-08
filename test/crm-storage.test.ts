import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  it,
  expect,
  vi
} from "vitest";
import { app } from "../src/server/api";
import { receiveMail } from "../src/server/mail";
import { sha256 } from "../src/server/auth";
import { crmApi, crmOutboxStatement, flushCrmOutbox } from "../src/server/crm";
import type { Env } from "../src/server/env";
let mf: Miniflare, db: any, env: Env;
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: "2026-11-08",
      d1Databases: ["DB"]
    })
  );
  db = await mf.getD1Database("DB");
  for (const file of [
    "0001_initial.sql",
    "0002_notifications.sql",
    "0003_message_sequence.sql",
    "0004_mail_original.sql",
    "0005_space_archive.sql",
    "0006_crm.sql"
  ]) {
    const sql = await readFile(
      new URL("../migrations/" + file, import.meta.url),
      "utf8"
    );
    await db.exec(
      sql
        .split("\n")
        .filter((s) => !s.trim().startsWith("--"))
        .join(" ")
    );
  }
  env = {
    LIVE: {
      idFromName: (s: string) => s,
      get: () => ({ fetch: async () => Response.json({ ok: true }) })
    },
    FILES: { put: async () => {} },
    DB: db,
    CRM_TOKEN: "secret",
    CRM_URL: "https://crm.example.com",
    HUB_CONFIG: JSON.stringify({
      appOrigin: "https://chat.example.com",
      domain: "mail.example.com",
      mailFrom: "chat@example.com"
    })
  } as unknown as Env;
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  await db.exec(
    "DELETE FROM events; DELETE FROM sessions; DELETE FROM mail_originals; DELETE FROM messages_fts; DELETE FROM message_addressees; DELETE FROM message_mentions; DELETE FROM crm_outbox; DELETE FROM crm_channel_links; DELETE FROM crm_spaces; DELETE FROM messages; DELETE FROM channels; DELETE FROM space_members; DELETE FROM spaces; DELETE FROM users; INSERT INTO users(id,email,name,role) VALUES ('admin','admin@example.com','管理者','admin'),('member','member@example.com','担当','member'),('guest','guest@example.com','ゲスト','guest'); INSERT INTO spaces(id,name) VALUES ('space','既存スペース'); INSERT INTO channels(id,space_id,name) VALUES ('ch','space','案件チャンネル');"
  );
});
afterEach(() => vi.unstubAllGlobals());
const request = (path: string, body: any, secret = "secret") =>
  crmApi.request(
    "https://chat.example.com" + path,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + secret,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ actor_email: "admin@example.com", ...body })
    },
    env
  );
it("requires token and actor permissions even with a service token", async () => {
  expect((await request("/link", {}, "bad")).status).toBe(401);
  expect(
    (await request("/link", { actor_email: "guest@example.com" })).status
  ).toBe(403);
  expect(
    (
      await request("/link", {
        actor_email: "member@example.com",
        deal_id: "d",
        company_id: "c",
        company_name: "会社",
        deal_title: "案件",
        channel_id: "ch"
      })
    ).status
  ).toBe(403);
});
it("creates a private company space and an idempotent deal channel", async () => {
  const body = {
    deal_id: "d",
    company_id: "c",
    company_name: "会社",
    deal_title: "案件",
    create: true
  };
  const r = await request("/link", body);
  expect(r.status).toBe(201);
  const d: any = await r.json();
  expect(
    (
      await db
        .prepare("SELECT all_members FROM spaces WHERE id=?")
        .bind(d.space_id)
        .first()
    ).all_members
  ).toBe(0);
  const again: any = await (await request("/link", body)).json();
  expect(again.channel_id).toBe(d.channel_id);
});
it("prevents linking the same channel to another deal and cancels future exports on disconnect", async () => {
  const body = {
    deal_id: "d",
    company_id: "c",
    company_name: "会社",
    deal_title: "案件",
    channel_id: "ch"
  };
  expect((await request("/link", body)).status).toBe(201);
  expect((await request("/link", { ...body, deal_id: "other" })).status).toBe(
    409
  );
  await db.exec(
    "INSERT INTO messages(id,channel_id,author_id,body) VALUES ('m','ch','admin','記録')"
  );
  await crmOutboxStatement(env, "m", "message").run();
  await request("/disconnect", { deal_id: "d" });
  expect(
    (await db.prepare("SELECT cancelled_at FROM crm_outbox").first())
      .cancelled_at
  ).toBeTypeOf("number");
});
it("atomically snapshots only linked channel posts and avoids duplicate outbox rows", async () => {
  await request("/link", {
    deal_id: "d",
    company_id: "c",
    company_name: "会社",
    deal_title: "案件",
    channel_id: "ch"
  });
  await db.batch([
    db.prepare(
      "INSERT INTO messages(id,channel_id,author_id,body) VALUES ('m','ch','admin','記録')"
    ),
    crmOutboxStatement(env, "m", "message")
  ]);
  await crmOutboxStatement(env, "m", "message").run();
  const row = await db.prepare("SELECT * FROM crm_outbox").first();
  expect(JSON.parse(row.payload)).toMatchObject({
    deal_hint: "d",
    source: "chat",
    body: "記録",
    emails: ["admin@example.com"]
  });
  expect(
    (await db.prepare("SELECT count(*) n FROM crm_outbox").first()).n
  ).toBe(1);
  await db.exec(
    "INSERT INTO channels(id,space_id,name) VALUES ('unlinked','space','未連携'); INSERT INTO messages(id,channel_id,body) VALUES ('u','unlinked','非公開')"
  );
  await crmOutboxStatement(env, "u", "message").run();
  expect(
    (await db.prepare("SELECT count(*) n FROM crm_outbox").first()).n
  ).toBe(1);
});
it.each(["mail_in", "mail_out"] as const)(
  "queues %s with customer email",
  async (kind) => {
    await request("/link", {
      deal_id: "d",
      company_id: "c",
      company_name: "会社",
      deal_title: "案件",
      channel_id: "ch"
    });
    await db.exec(
      "INSERT INTO messages(id,channel_id,author_id,body) VALUES ('m','ch','admin','メール')"
    );
    await crmOutboxStatement(env, "m", kind, "customer@example.com").run();
    const row = await db.prepare("SELECT payload FROM crm_outbox").first();
    expect(JSON.parse(row.payload)).toMatchObject({
      source: "mail",
      kind,
      emails: ["customer@example.com"]
    });
  }
);
it("retries a failed delivery with backoff and marks successful retries exactly once", async () => {
  await request("/link", {
    deal_id: "d",
    company_id: "c",
    company_name: "会社",
    deal_title: "案件",
    channel_id: "ch"
  });
  await db.exec(
    "INSERT INTO messages(id,channel_id,author_id,body) VALUES ('m','ch','admin','記録')"
  );
  await crmOutboxStatement(env, "m", "message").run();
  const f = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
  vi.stubGlobal("fetch", f);
  const next = await flushCrmOutbox(env);
  expect(next).toBeGreaterThan(Date.now());
  let row = await db.prepare("SELECT * FROM crm_outbox").first();
  expect(row.delivered_at).toBeNull();
  expect(row.attempts).toBe(1);
  await db.exec("UPDATE crm_outbox SET next_attempt_at=0");
  f.mockResolvedValue(new Response("{}", { status: 200 }));
  expect(await flushCrmOutbox(env)).toBeNull();
  row = await db.prepare("SELECT * FROM crm_outbox").first();
  expect(row.delivered_at).toBeTypeOf("number");
  await flushCrmOutbox(env);
  expect(f).toHaveBeenCalledTimes(2);
});

it("queues messages from the actual channel API while failed mail is not recorded as sent", async () => {
  await request("/link", {
    deal_id: "d",
    company_id: "c",
    company_name: "会社",
    deal_title: "案件",
    channel_id: "ch"
  });
  await db
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)"
    )
    .bind(await sha256("local-session"), "admin", Date.now() + 100000)
    .run();
  const post = () =>
    app.fetch(
      new Request("https://chat.example.com/api/channels/ch/messages", {
        method: "POST",
        headers: {
          cookie: "thechat_session=local-session",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ body: "実際の投稿" })
      }),
      env,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
  expect((await post()).status).toBe(201);
  const row = await db.prepare("SELECT payload FROM crm_outbox").first();
  expect(JSON.parse(row.payload)).toMatchObject({
    source: "chat",
    body: "実際の投稿",
    deal_hint: "d"
  });
});
