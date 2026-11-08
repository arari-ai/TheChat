export const INTENTS = {
  行動: 'ACTION', 承認: 'SIGN', 情報: 'INFO', 決断: 'DECISION', 要求: 'REQUEST', 調整: 'COORD',
} as const;
export type Intent = typeof INTENTS[keyof typeof INTENTS];
export type Principal = { role: 'admin' | 'member' | 'guest'; spaces: string[] };

export function parseIntent(text: string): { body: string; intent: Intent | null } {
  const match = text.match(/^\/(行動|承認|情報|決断|要求|調整)(?:\s+|$)/);
  if (!match) return { body: text.trim(), intent: null };
  return { body: text.slice(match[0].length).trim(), intent: INTENTS[match[1] as keyof typeof INTENTS] };
}
export function canSeeSpace(user: Principal, spaceId: string): boolean {
  return user.role === 'admin' || user.spaces.includes(spaceId);
}
export function canContact(a: Principal, b: Principal): boolean {
  return a.role === 'admin' || a.spaces.some(id => b.spaces.includes(id));
}
export function canComplete(userId: string, addressees: string[], intent: Intent | null): boolean {
  return !!intent && intent !== 'INFO' && addressees.includes(userId);
}
export function channelMailAddress(id: string, domain: string, routeAddress?: string): string {
  const route=routeAddress?.split('@')[0];
  return route?`${route}+${id}@${domain}`:`channel-${id}@${domain}`;
}
export function nextMessageId(now = Date.now(), random = Math.random): string {
  const time = now.toString(36).padStart(12, '0');
  const suffix = Math.floor(random() * 2 ** 32).toString(36).padStart(7, '0');
  return `${time}${suffix}`;
}
export function pageCursor<T extends { id: string }>(items: T[], direction: 'older' | 'newer'): string | null {
  if (!items.length) return null;
  return direction === 'older' ? items[0].id : items[items.length - 1].id;
}
