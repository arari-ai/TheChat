import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const base=process.argv[2]||'http://127.0.0.1:8878';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local smoke test only accepts localhost');
const cfg=JSON.parse(await readFile('wrangler.jsonc','utf8'));
const db=cfg.d1_databases[0].database_name;
function sql(command){execFileSync('node_modules/.bin/wrangler',['d1','execute',db,'--local','--config','wrangler.jsonc','--command',command],{stdio:'pipe'});}
const stamp=Date.now();const admin=`smoke-admin-${stamp}`;const guest=`smoke-guest-${stamp}`;const secret=`local-smoke-${stamp}`;const guestSecret=`${secret}-guest`;
const hash=createHash('sha256').update(secret).digest('hex');const guestHash=createHash('sha256').update(guestSecret).digest('hex');
sql(`INSERT INTO users(id,email,name,role) VALUES('${admin}','smoke-${stamp}@example.com','管理者','admin'),('${guest}','guest-${stamp}@example.com','ゲスト','guest');INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('${hash}','${admin}',${Date.now()+3600000}),('${guestHash}','${guest}',${Date.now()+3600000});`);
const adminCookie=`thechat_session=${secret}`;
async function request(path,options={},cookie=adminCookie){
  const response=await fetch(base+path,{...options,headers:{cookie,'content-type':'application/json',...options.headers}});
  const body=await response.json().catch(()=>null);return {status:response.status,body};
}
const space=await request('/api/spaces',{method:'POST',body:JSON.stringify({name:'検証スペース',allMembers:false})});assert.equal(space.status,201,JSON.stringify(space));
const channel=await request('/api/channels',{method:'POST',body:JSON.stringify({spaceId:space.body.id,name:'検証'})});assert.equal(channel.status,201,JSON.stringify(channel));
const notification=await request('/api/notification-settings');assert.equal(notification.body.emailDelayMinutes,15);
const changedNotification=await request('/api/notification-settings',{method:'POST',body:JSON.stringify({emailEnabled:false,emailDelayMinutes:30})});assert.equal(changedNotification.status,200);
const changedChannel=await request(`/api/channels/${channel.body.id}/notification-settings`,{method:'POST',body:JSON.stringify({mode:'all'})});assert.equal(changedChannel.status,200);
const mailPolicy=await request(`/api/channels/${channel.body.id}/mail-policy`,{method:'POST',body:JSON.stringify({policy:'allowlist',allowlist:['@example.com']})});assert.equal(mailPolicy.status,200);
const forbidden=await request(`/api/channels/${channel.body.id}/messages`,{},`thechat_session=${guestSecret}`);assert.equal(forbidden.status,404);
let firstId='';
for(let n=0;n<51;n++){const posted=await request(`/api/channels/${channel.body.id}/messages`,{method:'POST',body:JSON.stringify({body:`投稿 ${n}`})});assert.equal(posted.status,201,JSON.stringify(posted));if(n===0)firstId=posted.body.id;}
const page=await request(`/api/channels/${channel.body.id}/messages`);assert.equal(page.status,200);assert.equal(page.body.messages.length,50);assert.equal(page.body.hasMore,true);
sql(`INSERT INTO message_addressees(message_id,user_id) VALUES('${firstId}','${guest}')`);
const hiddenInbox=await request('/api/inbox',{},`thechat_session=${guestSecret}`);assert.equal(hiddenInbox.body.items.length,0,'A non-member must not see a former addressee item');
sql(`INSERT INTO space_members(space_id,user_id) VALUES('${space.body.id}','${guest}')`);
sql(`UPDATE messages SET source='email',mail_subject='検証メール' WHERE id='${firstId}';INSERT INTO mail_originals(message_id,body) VALUES('${firstId}','元のメール全文')`);
const mailFeed=await request(`/api/mail/received?spaceId=${space.body.id}`,{},`thechat_session=${guestSecret}`);assert.equal(mailFeed.status,200);assert.equal(mailFeed.body.items[0].id,firstId);
const original=await request(`/api/messages/${firstId}/original`,{},`thechat_session=${guestSecret}`);assert.equal(original.body.body,'元のメール全文');
const action=await request(`/api/channels/${channel.body.id}/messages`,{method:'POST',body:JSON.stringify({body:'承認してください',intent:'SIGN',mentions:[guest]})});assert.equal(action.status,201,JSON.stringify(action));
const pending=await request('/api/inbox?tab=pending',{},`thechat_session=${guestSecret}`);assert.equal(pending.status,200);assert.equal(pending.body.items[0].id,action.body.id);assert.deepEqual(JSON.parse(pending.body.items[0].addressees),[guest]);
const response=await request(`/api/messages/${action.body.id}/respond`,{method:'POST',body:JSON.stringify({status:'done'})},`thechat_session=${guestSecret}`);assert.equal(response.status,200,JSON.stringify(response));
const guestDone=await request('/api/inbox?tab=done',{},`thechat_session=${guestSecret}`);assert.equal(guestDone.body.items[0].id,action.body.id);
const authorDone=await request('/api/inbox?tab=done');assert.equal(authorDone.body.items[0].id,action.body.id);
const older=await request(`/api/channels/${channel.body.id}/messages?before=${page.body.cursor}`);assert.equal(older.status,200);assert.equal(older.body.messages.length,1);assert.equal(older.body.messages[0].id,firstId);
const reply=await request(`/api/channels/${channel.body.id}/messages`,{method:'POST',body:JSON.stringify({body:'返信',threadRootId:firstId})});assert.equal(reply.status,201,JSON.stringify(reply));
const thread=await request(`/api/channels/${channel.body.id}/messages?thread=${firstId}`);assert.equal(thread.body.messages.length,1);assert.equal(thread.body.messages[0].body,'返信');
const live=await request('/api/live');assert.equal(live.status,426);
await writeFile('.local-smoke-cookie',adminCookie,{mode:0o600});
console.log('Local smoke passed: access, paging, thread, inbox, mail, settings and live guard');
