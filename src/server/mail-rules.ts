export function trustedMail(firstAuthenticationResult: string | null): boolean {
  if (!firstAuthenticationResult) return false;
  const parts = firstAuthenticationResult.toLowerCase().split(';').map(part => part.trim());
  return parts[0] === 'mx.cloudflare.net' && ['spf', 'dkim', 'dmarc'].every(name =>
    parts.some(part => new RegExp(`^${name}=pass(?:\\s|$)`).test(part)));
}
export function attachmentAllowed(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= 25 * 1024 * 1024;
}
