import { describe, expect, it } from 'vitest';
import { shouldSend, nextThreadState } from '../src/client/logic';

describe('composer and thread navigation', () => {
  it('sends with Ctrl or Command Enter even while suggestions are open', () => {
    expect(shouldSend({key:'Enter',ctrlKey:true,metaKey:false},true)).toBe(true);
    expect(shouldSend({key:'Enter',ctrlKey:false,metaKey:true},true)).toBe(true);
    expect(shouldSend({key:'Enter',ctrlKey:false,metaKey:false},true)).toBe(false);
  });
  it('clears the old thread cursor and messages on switch', () => {
    expect(nextThreadState('new-root')).toEqual({rootId:'new-root',messages:[],cursor:null});
  });
});
