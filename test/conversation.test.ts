import {it,expect} from 'vitest';
import {refreshMessages} from '../src/client/useConversation';
it('refreshes through the oldest loaded page so deleted old posts and new messages are both reflected',async()=>{
 const pages:any[]=[{messages:[{id:'050'},{id:'051'}],hasMore:true,cursor:'050',replyCount:4},{messages:[{id:'010'},{id:'011'}],hasMore:true,cursor:'010'}];
 const result=await refreshMessages('/api/channels/c/messages?thread=root','010',async()=>pages.shift());
 expect(result.messages.map(m=>m.id)).toEqual(['010','011','050','051']);expect(result.cursor).toBe('010');expect(result.replyCount).toBe(4);
});
it('uses only the latest page on first entry',async()=>{const result=await refreshMessages('/api/dms/d/messages',null,async()=>({messages:[{id:'050'}],hasMore:true,cursor:'050'}) as any);expect(result.messages.map(m=>m.id)).toEqual(['050']);expect(result.hasMore).toBe(true);});
