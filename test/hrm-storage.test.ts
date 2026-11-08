import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  it,
  expect,
  vi,
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
      d1Databases: ["DB"],
    }),
  );
  db = await mf.getD1Database("DB");
  for (const file of [
    "0001_initial.sql",
    "0002_notifications.sql",
    "0003_message_sequence.sql",
    "0004_mail_original.sql",
    "0005_space_archive.sql",
    "0006_crm.sql",
    "0007_hrm.sql",
  ]) {
    const sql = await readFile(
      new URL("../migrations/" + file, import.meta.url),
      "utf8",
    );
    await db.exec(
      sql
        .split("\n")
        .filter((s) => !s.trim().startsWith("--"))
        .join(" "),
    );
  }
  env = {
    LIVE: {
      idFromName: (s: string) => s,
      get: () => ({ fetch: async () => Response.json({ ok: true }) }),
    },
    FILES: { put: async () => {} },
    DB: db,
    HRM_TOKEN: "secret",
    CRM_TOKEN: "secret",
    CRM_URL: "https://crm.example.com",
    HUB_CONFIG: JSON.stringify({
      appOrigin: "https://chat.example.com",
      domain: "mail.example.com",
      mailFrom: "chat@example.com",
    }),
  } as unknown as Env;
});
afterAll(async () => {
  await mf?.dispose();
});

it("requires a dedicated token and returns only non-guest minimum account fields", async () => {
  await db.exec(
    "INSERT INTO users(id,email,name,role) VALUES('admin','admin@example.com','Admin','admin'),('member','member@example.com','Member','member'),('guest','guest@example.com','Guest','guest')",
  );
  const call = (path: string, method = "GET", body?: unknown, key = "secret") =>
    app.request(
      "https://chat.example.com/api/hrm/" + path,
      {
        method,
        headers: {
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      env,
    );
  expect((await call("accounts", "GET", undefined, "bad")).status).toBe(401);
  expect(
    (
      await app.request(
        "/api/hrm/accounts",
        {},
        { ...env, HRM_TOKEN: undefined },
      )
    ).status,
  ).toBe(404);
  expect(
    ((await (await call("accounts")).json()) as any).accounts,
  ).toHaveLength(2);
  await db
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .bind(await sha256("session"), "member", Date.now() + 100000)
    .run();
  await db.exec("INSERT INTO spaces(id,name,all_members) VALUES('space','Team',1); INSERT INTO channels(id,space_id,name) VALUES('ch','space','General'); INSERT INTO messages(id,channel_id,author_id,body) VALUES('message','ch','member','Historical message'); INSERT INTO message_addressees VALUES('message','member','pending',NULL); INSERT INTO invitations(id,token_hash,email,role,space_id,expires_at) VALUES('invite','hash','member@example.com','member','space',9999999999999); INSERT INTO push_subscriptions VALUES('push','member','https://push.example/sub','p256','auth');");
  await db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await sha256('admin-session'),'admin',Date.now()+100000).run();
  expect(
    (
      (await (
        await call("disable", "POST", { email: " MEMBER@EXAMPLE.COM " })
      ).json()) as any
    ).result,
  ).toBe("disabled");
  expect(
    (await call("disable", "POST", { email: "admin@example.com" })).status,
  ).toBe(409);
  expect(
    (
      (await (
        await call("disable", "POST", { email: "member@example.com" })
      ).json()) as any
    ).result,
  ).toBe("already_disabled");
  expect(
    (
      await app.request(
        "/api/me",
        { headers: { cookie: "thechat_session=session" } },
        env,
      )
    ).status,
  ).toBe(401);
  const adminInit={headers:{cookie:'thechat_session=admin-session'}};
  const people=await(await app.request('/api/users',adminInit,env)).json() as any;
  expect(people.users.some((u:any)=>u.id==='member')).toBe(false);
  const history=await(await app.request('/api/channels/ch/messages',adminInit,env)).json() as any;
  expect(history.messages[0].body).toBe('Historical message');expect(history.messages[0].author_disabled_at).toBeTruthy();
  expect((await db.prepare('SELECT status FROM message_addressees').first()).status).toBe('pending');
  expect((await db.prepare('SELECT expires_at FROM invitations').first()).expires_at).toBe(0);
  expect((await db.prepare('SELECT * FROM push_subscriptions').all()).results).toHaveLength(0);
  expect((await app.request('/api/dms',{method:'POST',headers:{cookie:'thechat_session=admin-session','Content-Type':'application/json'},body:JSON.stringify({userIds:['member']})},env)).status).toBe(404);
  const request = await app.request(
    "/api/auth/request",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "member@example.com" }),
    },
    env,
  );
  expect(await request.json()).toEqual({ ok: true });
  expect(
    (await db.prepare("SELECT * FROM login_codes").all()).results,
  ).toHaveLength(0);
  expect(
    (
      (await (
        await call("enable", "POST", { email: "member@example.com" })
      ).json()) as any
    ).result,
  ).toBe("enabled");
  expect((await db.prepare("SELECT * FROM users").all()).results).toHaveLength(
    3,
  );
});
