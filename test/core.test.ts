import { describe, expect, it } from 'vitest';
import { parseIntent, canSeeSpace, canContact, pageCursor, nextMessageId, canComplete } from '../src/shared/core';

describe('message rules', () => {
  it('parses optional leading intent without forcing a tag', () => {
    expect(parseIntent('/承認 内容')).toEqual({ body: '内容', intent: 'SIGN' });
    expect(parseIntent('普通の投稿')).toEqual({ body: '普通の投稿', intent: null });
  });
  it('keeps cursor ordering across more than 50 messages', () => {
    const ids = Array.from({ length: 51 }, (_, n) => nextMessageId(1000 + n, () => 0));
    expect(ids).toEqual([...ids].sort());
    expect(pageCursor(ids.slice(0, 50).map(id => ({ id })), 'older')).toBe(ids[0]);
  });
  it('limits guests to shared spaces and shared contacts', () => {
    expect(canSeeSpace({ role: 'guest', spaces: ['a'] }, 'b')).toBe(false);
    expect(canContact({ role: 'guest', spaces: ['a'] }, { role: 'guest', spaces: ['b'] })).toBe(false);
    expect(canContact({ role: 'member', spaces: ['a'] }, { role: 'guest', spaces: ['a'] })).toBe(true);
  });
  it('allows only an addressee to finish a requested action', () => {
    expect(canComplete('u2', ['u2'], 'ACTION')).toBe(true);
    expect(canComplete('u3', ['u2'], 'ACTION')).toBe(false);
    expect(canComplete('u2', ['u2'], 'INFO')).toBe(false);
  });
});
