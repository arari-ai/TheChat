import { describe, expect, it } from 'vitest';
import { trustedMail, attachmentAllowed } from '../src/server/mail-rules';

describe('incoming mail safety', () => {
  it('trusts only Cloudflare first authentication result', () => {
    expect(trustedMail('mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass','sender@example.com','sender@example.com')).toBe(true);
    expect(trustedMail('attacker.example; spf=pass; dkim=pass; dmarc=pass','sender@example.com','sender@example.com')).toBe(false);
    expect(trustedMail('mx.cloudflare.net; spf=fail; dkim=fail; dmarc=fail','sender@example.com','sender@example.com')).toBe(false);
  });
  it('accepts authenticated mail without a DMARC policy only when sender addresses match', () => {
    expect(trustedMail('mx.cloudflare.net; spf=pass; dkim=pass; dmarc=none','sender@example.com','sender@example.com')).toBe(true);
    expect(trustedMail('mx.cloudflare.net; spf=pass; dkim=pass; dmarc=none','attacker@example.com','sender@example.com')).toBe(false);
    expect(trustedMail('mx.cloudflare.net; spf=pass; dkim=fail; dmarc=none','sender@example.com','sender@example.com')).toBe(false);
    expect(trustedMail('mx.cloudflare.net; spf=pass; dkim=pass; dmarc=fail','sender@example.com','sender@example.com')).toBe(false);
  });
  it('caps one attachment at 25 MB', () => {
    expect(attachmentAllowed(25 * 1024 * 1024)).toBe(true);
    expect(attachmentAllowed(25 * 1024 * 1024 + 1)).toBe(false);
  });
});
