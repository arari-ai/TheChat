export function trustedMail(firstAuthenticationResult: string | null, envelopeFrom: string, visibleFrom: string | null): boolean {
  if (!firstAuthenticationResult) return false;
  const parts = firstAuthenticationResult.toLowerCase().split(';').map(part => part.trim());
  if(parts[0] !== 'mx.cloudflare.net') return false;
  const result=(name:string,value:string)=>parts.some(part=>new RegExp(`^${name}=${value}(?:\\s|$)`).test(part));
  if(result('dmarc','fail'))return false;
  if(result('dmarc','pass'))return true;
  return result('dmarc','none') && result('spf','pass') && result('dkim','pass') &&
    !!visibleFrom && envelopeFrom.trim().toLowerCase()===visibleFrom.trim().toLowerCase();
}
export function attachmentAllowed(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= 25 * 1024 * 1024;
}
