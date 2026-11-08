import { describe, expect, it } from 'vitest';
import { trustedMail, attachmentAllowed } from '../src/server/mail-rules';

describe('incoming mail safety', () => {
  it('trusts only Cloudflare first authentication result', () => {
    expect(trustedMail('mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass','info@yosuke.io','info@yosuke.io')).toBe(true);
    expect(trustedMail('attacker.example; spf=pass; dkim=pass; dmarc=pass','info@yosuke.io','info@yosuke.io')).toBe(false);
    expect(trustedMail('mx.cloudflare.net; spf=fail; dkim=fail; dmarc=fail','info@yosuke.io','info@yosuke.io')).toBe(false);
  });
  it('accepts authenticated mail without a DMARC policy only when sender addresses match', () => {
    expect(trustedMail('mx.cloudflare.net; spf=pass; dkim=pass; dmarc=none','info@yosuke.io','info@yosuke.io')).toBe(true);
    expect(trustedMail('mx.cloudflare.net; spf=pass; dkim=pass; dmarc=none','attacker@example.com','info@yosuke.io')).toBe(false);
    expect(trustedMail('mx.cloudflare.net; spf=pass; dkim=fail; dmarc=none','info@yosuke.io','info@yosuke.io')).toBe(false);
    expect(trustedMail('mx.cloudflare.net; spf=pass; dkim=pass; dmarc=fail','info@yosuke.io','info@yosuke.io')).toBe(false);
  });
  it('caps one attachment at 25 MB', () => {
    expect(attachmentAllowed(25 * 1024 * 1024)).toBe(true);
    expect(attachmentAllowed(25 * 1024 * 1024 + 1)).toBe(false);
  });
});
