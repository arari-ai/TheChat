import { describe, expect, it } from 'vitest';
import { shouldSend, nextThreadState } from '../src/client/logic';

describe('composer and thread navigation', () => {
  it('sends with Ctrl or Command Enter even while suggestions are open', () => {
    expect(shouldSend({key:'Enter',ctrlKey:true,metaKey:false},true)).toBe(true);
    expect(shouldSend({key:'Enter',ctrlKey:false,metaKey:true},true)).toBe(true);
    expect(shouldSend({key:'Enter',ctrlKey:false,metaKey:false},true)).toBe(false);
  });
  it('clears the old thread cursor and messages on switch', () => {
    expect(nextThreadState('old-root','new-root',['old reply'],'old-cursor')).toEqual({rootId:'new-root',messages:[],cursor:null});
  });
  it('keeps replies when the same thread is opened again', () => {
    expect(nextThreadState('same-root','same-root',['reply 1','reply 2'],'cursor')).toEqual({rootId:'same-root',messages:['reply 1','reply 2'],cursor:'cursor'});
  });
});
