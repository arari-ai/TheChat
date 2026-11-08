import { describe, it, expect, vi } from "vitest";
import {
  buildCrmEvent,
  deliverCrmEvent,
  crmTokenValid
} from "../src/server/crm";
const base = {
  id: "0000000000000001",
  channel_id: "channel",
  thread_root_id: null,
  body: "こんにちは",
  created_at: "2026-11-08 10:00:00",
  author_email: " PERSON@example.com ",
  author_name: "顧客",
  external_email: null,
  external_name: null,
  mail_subject: null
};
describe("CRM delivery", () => {
  it("builds channel scoped chat payloads with normalized email and UTC milliseconds", () => {
    const e = buildCrmEvent(
      base,
      "message",
      { deal_id: "deal" },
      "https://chat.example.com"
    );
    expect(e).toMatchObject({
      source: "chat",
      kind: "message",
      external_id: "thechat:channel:0000000000000001",
      chat_channel_id: "channel",
      deal_hint: "deal",
      emails: ["person@example.com"],
      occurred_at: Date.parse("2026-11-08T10:00:00Z")
    });
    expect(e.url).toContain("?channel=channel");
  });
  it.each(["mail_in", "mail_out"] as const)(
    "maps %s to a mail activity with customer email",
    (kind) => {
      expect(
        buildCrmEvent(
          { ...base, external_email: "customer@example.com" },
          kind,
          { deal_id: "deal" },
          "https://chat.example.com"
        )
      ).toMatchObject({
        source: "mail",
        kind,
        emails: ["customer@example.com"]
      });
    }
  );
  it("does not export direct messages", () => {
    expect(() =>
      buildCrmEvent(
        { ...base, channel_id: null },
        "message",
        { deal_id: "deal" },
        "https://chat.example.com"
      )
    ).toThrow();
  });
  it("rejects missing and incorrect service tokens", async () => {
    expect(await crmTokenValid("Bearer wrong", "secret")).toBe(false);
    expect(await crmTokenValid("Bearer secret", undefined)).toBe(false);
    expect(await crmTokenValid("Bearer secret", "secret")).toBe(true);
  });
  it("treats only successful ingest responses as delivered and keeps secrets in the header", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    expect(
      await deliverCrmEvent(
        { CRM_URL: "https://crm.example.com", CRM_TOKEN: "secret" } as any,
        { title: "test" } as any,
        f
      )
    ).toBe(200);
    const [url, options] = f.mock.calls[0];
    expect(url).toBe("https://crm.example.com/api/ingest/events");
    expect(options.headers.Authorization).toBe("Bearer secret");
    expect(options.redirect).toBe("manual");
    f.mockResolvedValue(new Response("{}", { status: 503 }));
    expect(
      await deliverCrmEvent(
        { CRM_URL: "https://crm.example.com", CRM_TOKEN: "secret" } as any,
        {} as any,
        f
      )
    ).toBe(503);
  });
});
