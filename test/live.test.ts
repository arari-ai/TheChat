import { describe, expect, it } from 'vitest';
import { retryDelay, eventsAfter } from '../src/shared/live';

describe('live recovery', () => {
  it('retries disconnects with a bounded delay', () => {
    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(9)).toBe(30000);
  });
  it('fetches only events after the last received cursor', () => {
    expect(eventsAfter([{ id: '01' }, { id: '02' }, { id: '03' }], '01')).toEqual([{ id: '02' }, { id: '03' }]);
  });
});
