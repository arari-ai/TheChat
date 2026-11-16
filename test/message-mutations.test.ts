import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import {app} from '../src/server/api';
import {sha256} from '../src/server/auth';
import type {Env} from '../src/server/env';
let mf:Miniflare,db:D1Database,env:Env;
beforeAll(async()=>{mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-11-08',d1Databases:['DB']}));db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec((await readFile(new URL('../migrations/'+file,import.meta.url),'utf8')).split('\n').filter(s=>!s.trim().startsWith('--')).join(' '));
 env={DB:db,HUB_CONFIG:'{}',LIVE:{idFromName:(s:string)=>s,get:()=>({fetch:async()=>Response.json({connections:1})})},FILES:{get:async()=>{throw Error('Deleted attachment must not be fetched')}}} as unknown as Env;
 for(const [id,role] of [['owner','member'],['other','member'],['admin','admin'],['outsider','guest']]){await db.prepare('INSERT INTO users(id,email,name,role) VALUES(?,?,?,?)').bind(id,id+'@example.test',id,role).run();await db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await sha256(id),id,Date.now()+3600000).run();}
 await db.exec("INSERT INTO spaces(id,name,all_members) VALUES('s','Space',0); INSERT INTO space_members VALUES('s','owner'),('s','other'); INSERT INTO channels(id,space_id,name) VALUES('ch','s','Channel'); INSERT INTO dm_conversations(id) VALUES('dm'); INSERT INTO dm_members VALUES('dm','owner'),('dm','other');");
});
afterAll(async()=>{await mf.dispose()});
beforeEach(async()=>{await db.exec("DELETE FROM attachments; DELETE FROM events; DELETE FROM reactions; DELETE FROM message_addressees; DELETE FROM message_mentions; DELETE FROM messages_fts; DELETE FROM messages; UPDATE users SET disabled_at=NULL; UPDATE channels SET archived=0; INSERT OR IGNORE INTO space_members VALUES('s','owner'); INSERT INTO messages(id,channel_id,author_id,body,intent) VALUES('root','ch','owner','Original text','ACTION'); INSERT INTO messages(id,channel_id,thread_root_id,author_id,body) VALUES('reply','ch','root','other','Other reply'); INSERT INTO messages_fts(body,message_id,channel_id) VALUES('Original text','root','ch');");});
const call=async(id:string,method='GET',body?:unknown,user='owner',bindings=env)=>{const pending:Promise<unknown>[]=[];const response=await app.request('https://chat.test/api/'+id,{method,headers:{'Content-Type':'application/json',...(user?{Cookie:'thechat_session='+user}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})},bindings,{waitUntil:(p:Promise<unknown>)=>pending.push(p),passThroughOnException:()=>{},props:{}});await Promise.all(pending);return response;};
it('requires authenticated author and preserves metadata while updating search and multiline text',async()=>{
 expect((await call('messages/root','PATCH',{body:'Updated\ntext',expectedBody:'Original text'},'')).status).toBe(401);
 for(const user of ['other','admin'])expect((await call('messages/root','PATCH',{body:'Updated',expectedBody:'Original text'},user)).status).toBe(403);
 expect((await call('messages/root','PATCH',{body:'Updated\ntext',expectedBody:'Original text'})).status).toBe(200);
 expect(await db.prepare("SELECT body,intent,edited_at FROM messages WHERE id='root'").first()).toMatchObject({body:'Updated\ntext',intent:'ACTION',edited_at:expect.any(String)});
 expect((await (await call('search?q=Original')).json() as any).items).toHaveLength(0);
 expect((await (await call('search?q=Updated')).json() as any).items).toHaveLength(1);
});
it('validates body-only changes and rejects stale edits without losing the saved version',async()=>{
 for(const body of [{body:' ',expectedBody:'Original text'},{body:'x'.repeat(10001),expectedBody:'Original text'},{body:'New',expectedBody:'Original text',intent:'SIGN'},{body:'New'}])expect((await call('messages/root','PATCH',body)).status).toBe(400);
 expect((await call('messages/root','PATCH',{body:'New',expectedBody:'stale'})).status).toBe(409);
 expect(await db.prepare("SELECT body FROM messages WHERE id='root'").first('body')).toBe('Original text');
});
it('blocks mutations after membership removal, archive or account disable',async()=>{
 await db.exec("DELETE FROM space_members WHERE user_id='owner'");expect((await call('messages/root','DELETE')).status).toBe(404);
 await db.exec("INSERT INTO space_members VALUES('s','owner'); UPDATE channels SET archived=1");expect((await call('messages/root','PATCH',{body:'New',expectedBody:'Original text'})).status).toBe(404);
 await db.exec("UPDATE channels SET archived=0; UPDATE users SET disabled_at='now' WHERE id='owner'");expect((await call('messages/root','DELETE')).status).toBe(401);
});
it('keeps replies and a sanitized parent after author deletion and hides other read routes',async()=>{
 await db.exec("INSERT INTO attachments(id,message_id,r2_key,filename,media_type,bytes) VALUES('file','root','key','private.txt','text/plain',10); INSERT INTO message_addressees VALUES('root','other','pending',NULL); INSERT INTO reactions VALUES('root','other','ありがとう');");
 expect((await call('messages/root','DELETE',undefined,'other')).status).toBe(403);
 expect((await call('messages/root','DELETE')).status).toBe(200);
 const messages=(await (await call('channels/ch/messages')).json() as any).messages;
 expect(messages).toHaveLength(1);expect(messages[0]).toMatchObject({id:'root',body:'',intent:null,external_email:null,attachment_list:'[]',reactions:'[]',addressees:'[]',reply_count:1,deleted_at:expect.any(String)});
 expect((await (await call('channels/ch/messages?thread=root')).json() as any).messages[0].body).toBe('Other reply');
 expect((await (await call('search?q=Original')).json() as any).items).toHaveLength(0);
 expect((await (await call('inbox', 'GET',undefined,'other')).json() as any).items).toHaveLength(0);
 expect((await call('attachments/file')).status).toBe(404);
 expect((await call('messages/root','PATCH',{body:'Restore',expectedBody:''})).status).toBe(404);
 expect((await call('messages/root/reactions','POST',{kind:'了解'})).status).toBe(404);
 expect((await call('messages/root/respond','POST',{status:'done'},'other')).status).toBe(404);
});
it('supports the same author boundary in direct messages and refuses incoming email edits',async()=>{
 await db.exec("INSERT INTO messages(id,dm_id,author_id,body) VALUES('direct','dm','owner','Direct'); UPDATE messages SET source='email' WHERE id='root'");
 expect((await call('messages/direct','PATCH',{body:'DM updated',expectedBody:'Direct'},'other')).status).toBe(403);
 expect((await call('messages/direct','PATCH',{body:'DM updated',expectedBody:'Direct'})).status).toBe(200);
 expect((await call('messages/direct','DELETE')).status).toBe(200);
 expect((await call('messages/root','PATCH',{body:'Mail edited',expectedBody:'Original text'})).status).toBe(403);
});
it('lets each reply author delete their own remaining reply after parent deletion',async()=>{
 expect((await call('messages/root','DELETE')).status).toBe(200);
 expect((await call('messages/reply','DELETE')).status).toBe(403);
 expect((await call('messages/reply','PATCH',{body:'Reply edited',expectedBody:'Other reply'},'other')).status).toBe(200);
 expect((await call('messages/reply','DELETE',undefined,'other')).status).toBe(200);
 expect((await (await call('channels/ch/messages?thread=root')).json() as any).messages).toHaveLength(0);
 expect((await (await call('messages/root')).json() as any).message.body).toBe('');
});

it('fences DM shared-space revocation between preflight and the transaction',async()=>{
 await db.exec("INSERT INTO messages(id,dm_id,author_id,body) VALUES('direct','dm','owner','Direct')");
 for(const method of ['PATCH','DELETE']){
  await db.exec("INSERT OR IGNORE INTO space_members VALUES('s','other')");
  const revoked={...env,DB:{prepare:(sql:string)=>db.prepare(sql),batch:async(statements:D1PreparedStatement[])=>{await db.exec("DELETE FROM space_members WHERE space_id='s' AND user_id='other'");return db.batch(statements);}}} as Env;
  expect((await call('messages/direct',method,method==='PATCH'?{body:'Changed',expectedBody:'Direct'}:undefined,'owner',revoked)).status).toBe(409);
  expect(await db.prepare("SELECT body,deleted_at FROM messages WHERE id='direct'").first()).toEqual({body:'Direct',deleted_at:null});
 }
});
