import { describe,expect,it } from 'vitest';
import { formatMessageId } from '../src/server/db';

describe('D1 message sequence',()=>{
  it('sorts numeric sequence keys lexically across page boundaries',()=>{
    expect(formatMessageId(51)).toBe('0000000000000051');
    expect(formatMessageId(100).localeCompare(formatMessageId(99))).toBe(1);
  });
});
