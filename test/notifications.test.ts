import { describe, expect, it } from 'vitest';
import { dueForDigest } from '../src/server/notifications';

describe('email notification delay',()=>{
  it('waits the configured minutes before sending a summary',()=>{
    expect(dueForDigest(0,15,14*60*1000)).toBe(false);
    expect(dueForDigest(0,15,15*60*1000)).toBe(true);
  });
});
