import { describe, expect, it } from 'vitest';
import { validSubscription } from '../src/server/push';

describe('push subscriptions', () => {
  it('accepts a secure browser endpoint and encoded keys', () => {
    expect(validSubscription({endpoint:'https://push.example/send/1',keys:{p256dh:'abc_-',auth:'xyz'}})).toBe(true);
    expect(validSubscription({endpoint:'http://push.example/send/1',keys:{p256dh:'abc',auth:'xyz'}})).toBe(false);
  });
});
