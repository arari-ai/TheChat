import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, HubConfig } from './env';
import { config } from './env';
import { canAccessChannel, cookieName, getViewer, sendMail, sha256, spacesFor, token, type Viewer } from './auth';
import { channelMailAddress, parseIntent, type Intent } from '../shared/core';
import { sendPush, validSubscription } from './push';
import { allocateMessageId } from './db';

type Bindings = { Bindings: Env };
export const app = new Hono<Bindings>();
const jsonError = (c: Context<Bindings>, status: 400|401|403|404|409|429|500|503, error: string) => c.json({ error }, status);
const input = async (c: Context<Bindings>) => { try { return await c.req.json<Record<string, unknown>>(); } catch { return {}; } };
const validEmail = (s: unknown): s is string => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
const clean = (s: unknown, max = 100): string => typeof s === 'string' ? s.trim().slice(0,max) : '';
const asId = (s: unknown): string => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(s) ? s : '';
const createId = () => crypto.randomUUID();
const viewer = async (c: Context<Bindings>) => getViewer(c.req.raw,c.env);
const responseCookie = (value: string, request: Request) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;

app.use('/api/*', async (c,next) => {
  if (!['GET','HEAD','OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin) return jsonError(c,403,'Invalid origin');
  }
  await next();
});
app.get('/api/health', c => c.json({ ok:true, version:'1.0.0' }));
app.get('/api/bootstrap', async c => {
  const cfg = config(c.env);
  return c.json({ organizationName:cfg.organizationName || 'TheChat', fileTransferUrl:cfg.fileTransferUrl || null, calendarUrl:cfg.calendarUrl || null, user:await viewer(c) });
});
app.post('/api/auth/request', async c => {
  const body = await input(c); const email = clean(body.email,254).toLowerCase();
  if (!validEmail(email)) return jsonError(c,400,'メールアドレスを確認してください');
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  let invitation = null;
  const inviteToken = clean(body.inviteToken,128);
  if (inviteToken) invitation = await c.env.DB.prepare('SELECT id FROM invitations WHERE token_hash=? AND email=? AND expires_at>? AND accepted_at IS NULL').bind(await sha256(inviteToken),email,Date.now()).first();
  const adminEmail = config(c.env).adminEmail?.toLowerCase();
  if (!existing && !invitation && email !== adminEmail) return c.json({ ok:true });
  const recent = await c.env.DB.prepare('SELECT requested_at FROM login_codes WHERE email=?').bind(email).first<{requested_at:number}>();
  if (recent && recent.requested_at > Date.now()-60000) return c.json({ ok:true });
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6,'0');
  await c.env.DB.prepare('INSERT INTO login_codes(email,code_hash,expires_at,attempts,requested_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,requested_at=excluded.requested_at').bind(email,await sha256(`${email}:${code}`),Date.now()+600000,0,Date.now()).run();
  try { await sendMail(c.env,email,'TheChat ログインコード',`ログインコード: ${code}\n10分以内に入力してください。`); }
  catch {
    await c.env.DB.prepare('DELETE FROM login_codes WHERE email=?').bind(email).run();
    return jsonError(c,503,'メールを送信できませんでした');
  }
  return c.json({ ok:true });
});
app.post('/api/auth/verify', async c => {
  const body = await input(c); const email = clean(body.email,254).toLowerCase(); const code = clean(body.code,6);
  if (!validEmail(email) || !/^\d{6}$/.test(code)) return jsonError(c,400,'コードを確認してください');
  const row = await c.env.DB.prepare('SELECT code_hash,expires_at,attempts FROM login_codes WHERE email=?').bind(email).first<{code_hash:string;expires_at:number;attempts:number}>();
  if (!row || row.expires_at < Date.now() || row.attempts >= 5) return jsonError(c,401,'コードが無効です');
  await c.env.DB.prepare('UPDATE login_codes SET attempts=attempts+1 WHERE email=?').bind(email).run();
  if (row.code_hash !== await sha256(`${email}:${code}`)) return jsonError(c,401,'コードが無効です');
  let user = await c.env.DB.prepare('SELECT id,email,name,role,affiliation FROM users WHERE email=?').bind(email).first<Viewer>();
  if (!user) {
    const admin = email === config(c.env).adminEmail?.toLowerCase();
    const inviteToken = clean(body.inviteToken,128);
    const invitation = inviteToken ? await c.env.DB.prepare('SELECT id,role,space_id FROM invitations WHERE token_hash=? AND email=? AND expires_at>? AND accepted_at IS NULL').bind(await sha256(inviteToken),email,Date.now()).first<{id:string;role:Viewer['role'];space_id:string|null}>() : null;
    if (!admin && !invitation) return jsonError(c,403,'招待が必要です');
    user = { id:createId(), email, name:clean(body.name,80)||email.split('@')[0], role:admin?'admin':invitation!.role, affiliation:null };
    const statements = [c.env.DB.prepare('INSERT INTO users(id,email,name,role) VALUES(?,?,?,?)').bind(user.id,user.email,user.name,user.role)];
    if (invitation?.space_id) statements.push(c.env.DB.prepare('INSERT INTO space_members(space_id,user_id) VALUES(?,?)').bind(invitation.space_id,user.id));
    if (invitation) statements.push(c.env.DB.prepare('UPDATE invitations SET accepted_at=? WHERE id=?').bind(Date.now(),invitation.id));
    await c.env.DB.batch(statements);
  }
  await c.env.DB.prepare('DELETE FROM login_codes WHERE email=?').bind(email).run();
  const session = token();
  await c.env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha256(session),user.id,Date.now()+2592000000).run();
  c.header('Set-Cookie',responseCookie(session,c.req.raw));
  return c.json({ user });
});
app.post('/api/auth/logout', async c => {
  const cookie = c.req.header('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  if (cookie) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(cookie)).run();
  c.header('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return c.json({ ok:true });
});
app.get('/api/me', async c => { const user=await viewer(c); return user?c.json({user}):jsonError(c,401,'ログインしてください'); });

app.get('/api/spaces', async c => {
  const user=await viewer(c); if (!user) return jsonError(c,401,'ログインしてください');
  const ids=await spacesFor(c.env,user); if (!ids.length) return c.json({spaces:[]});
  const spaces=await c.env.DB.prepare(`SELECT * FROM spaces WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY sort_order,name`).bind(...ids).all();
  const channels=await c.env.DB.prepare(`SELECT * FROM channels WHERE archived=0 AND space_id IN (${ids.map(()=>'?').join(',')}) ORDER BY name`).bind(...ids).all();
  return c.json({spaces:spaces.results,channels:channels.results});
});
app.post('/api/spaces', async c => {
  const user=await viewer(c); if (!user) return jsonError(c,401,'ログインしてください'); if(user.role!=='admin') return jsonError(c,403,'管理者のみ操作できます');
  const body=await input(c); const name=clean(body.name,80); if(!name) return jsonError(c,400,'名前が必要です');
  const id=createId(); await c.env.DB.prepare('INSERT INTO spaces(id,name,all_members) VALUES(?,?,?)').bind(id,name,body.allMembers?1:0).run();
  return c.json({id,name},201);
});
app.get('/api/archives',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');if(user.role!=='admin')return jsonError(c,403,'管理者のみ操作できます');
  const [spaces,channels]=await Promise.all([c.env.DB.prepare('SELECT id,name FROM spaces WHERE archived=1 ORDER BY name').all(),c.env.DB.prepare('SELECT ch.id,ch.space_id,ch.name,s.name space_name,s.archived space_archived FROM channels ch JOIN spaces s ON s.id=ch.space_id WHERE ch.archived=1 ORDER BY s.name,ch.name').all()]);
  return c.json({spaces:spaces.results,channels:channels.results});
});
app.post('/api/spaces/:id/archive',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');if(user.role!=='admin')return jsonError(c,403,'管理者のみ操作できます');
  const id=asId(c.req.param('id'));const body=await input(c);if(typeof body.archived!=='boolean')return jsonError(c,400,'アーカイブ設定を確認してください');
  const changed=await c.env.DB.prepare('UPDATE spaces SET archived=? WHERE id=?').bind(body.archived?1:0,id).run();
  if(!changed.meta.changes)return jsonError(c,404,'スペースが見つかりません');
  return c.json({ok:true,archived:body.archived});
});
app.post('/api/channels', async c => {
  const user=await viewer(c); if(!user) return jsonError(c,401,'ログインしてください'); if(user.role==='guest') return jsonError(c,403,'チャンネルを作成できません');
  const body=await input(c); const spaceId=asId(body.spaceId); const name=clean(body.name,80);
  if(!spaceId||!name) return jsonError(c,400,'スペースと名前が必要です');
  if(!(await spacesFor(c.env,user)).includes(spaceId)) return jsonError(c,403,'参加していないスペースです');
  const id=createId(); const cfg=config(c.env); const domain=cfg.domain;
  const address=domain?channelMailAddress(id,domain,cfg.emailRouteAddress):null;
  await c.env.DB.prepare('INSERT INTO channels(id,space_id,name,mail_address) VALUES(?,?,?,?)').bind(id,spaceId,name,address).run();
  return c.json({id,name,spaceId,mailAddress:address},201);
});
app.post('/api/channels/:id/archive',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');if(user.role!=='admin')return jsonError(c,403,'管理者のみ操作できます');
  const id=asId(c.req.param('id'));const body=await input(c);if(typeof body.archived!=='boolean')return jsonError(c,400,'アーカイブ設定を確認してください');
  const changed=await c.env.DB.prepare('UPDATE channels SET archived=? WHERE id=? AND space_id IN (SELECT id FROM spaces WHERE archived=0)').bind(body.archived?1:0,id).run();
  if(!changed.meta.changes)return jsonError(c,404,'チャンネルが見つかりません');
  return c.json({ok:true,archived:body.archived});
});
app.get('/api/channels/:id/mail-policy',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');const channel=await canAccessChannel(c.env,user,c.req.param('id'));if(!channel)return jsonError(c,404,'見つかりません');
  const row=await c.env.DB.prepare('SELECT mail_address,mail_policy,mail_allowlist FROM channels WHERE id=?').bind(channel.id).first<{mail_address:string|null;mail_policy:string;mail_allowlist:string}>();
  return c.json({address:row?.mail_address,policy:row?.mail_policy||'any',allowlist:JSON.parse(row?.mail_allowlist||'[]')});
});
app.post('/api/channels/:id/mail-policy',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');if(user.role!=='admin')return jsonError(c,403,'管理者のみ操作できます');const channel=await canAccessChannel(c.env,user,c.req.param('id'));if(!channel)return jsonError(c,404,'見つかりません');
  const body=await input(c);const policy=body.policy;if(!['any','allowlist'].includes(String(policy)))return jsonError(c,400,'受信設定を確認してください');
  const allowlist=Array.isArray(body.allowlist)?body.allowlist.map(item=>clean(item,254).toLowerCase()):[];
  if(allowlist.length>100||allowlist.some(item=>!validEmail(item)&&!/^@[a-z0-9.-]+\.[a-z]{2,}$/i.test(item)))return jsonError(c,400,'許可アドレスを確認してください');
  await c.env.DB.prepare('UPDATE channels SET mail_policy=?,mail_allowlist=? WHERE id=?').bind(policy,JSON.stringify(allowlist),channel.id).run();return c.json({ok:true});
});
app.get('/api/users', async c => {
  const user=await viewer(c); if(!user) return jsonError(c,401,'ログインしてください');
  const ids=await spacesFor(c.env,user); if(!ids.length) return c.json({users:[]});
  const rows=await c.env.DB.prepare(`SELECT DISTINCT u.id,u.name,u.role,u.affiliation FROM users u WHERE u.id=? OR u.role='admin' OR EXISTS(SELECT 1 FROM space_members sm WHERE sm.user_id=u.id AND sm.space_id IN (${ids.map(()=>'?').join(',')})) OR (u.role='member' AND EXISTS(SELECT 1 FROM spaces s WHERE s.all_members=1 AND s.id IN (${ids.map(()=>'?').join(',')})))`).bind(user.id,...ids,...ids).all();
  return c.json({users:rows.results});
});
app.post('/api/invitations', async c => {
  const user=await viewer(c); if(!user) return jsonError(c,401,'ログインしてください'); if(user.role==='guest') return jsonError(c,403,'招待できません');
  const body=await input(c); const email=clean(body.email,254).toLowerCase(); const spaceId=asId(body.spaceId);
  if(!validEmail(email)||!spaceId) return jsonError(c,400,'宛先とスペースが必要です');
  if(user.role!=='admin'&&!(await spacesFor(c.env,user)).includes(spaceId)) return jsonError(c,403,'参加していないスペースです');
  const role=body.role==='member'&&user.role==='admin'?'member':'guest'; const inviteToken=token(); const id=createId();
  await c.env.DB.prepare('INSERT INTO invitations(id,token_hash,email,role,space_id,expires_at) VALUES(?,?,?,?,?,?)').bind(id,await sha256(inviteToken),email,role,spaceId,Date.now()+604800000).run();
  const link=`${new URL(c.req.url).origin}/?invite=${encodeURIComponent(inviteToken)}&email=${encodeURIComponent(email)}`;
  try { await sendMail(c.env,email,'TheChatへの招待',`招待リンク: ${link}\n7日以内に開いてください。`); }
  catch {
    await c.env.DB.prepare('DELETE FROM invitations WHERE id=?').bind(id).run();
    return jsonError(c,503,'メールを送信できませんでした');
  }
  return c.json({ok:true},201);
});

export async function channelParticipants(env:Env, spaceId:string):Promise<string[]> {
  const rows=await env.DB.prepare("SELECT DISTINCT u.id FROM users u LEFT JOIN space_members sm ON sm.user_id=u.id AND sm.space_id=? LEFT JOIN spaces s ON s.id=? WHERE u.role='admin' OR sm.user_id IS NOT NULL OR (s.all_members=1 AND u.role='member')").bind(spaceId,spaceId).all<{id:string}>();
  return rows.results.map(r=>r.id);
}
export async function emit(env:Env,userIds:string[],kind:string,messageId:string,channelId:string|null,dmId:string|null,notifyIds:string[]=[]):Promise<void> {
  if(!userIds.length) return;
  const notified=new Set(notifyIds);
  if(channelId){
    const settings=await env.DB.prepare('SELECT user_id,mode FROM channel_notification_settings WHERE channel_id=?').bind(channelId).all<{user_id:string;mode:string}>();
    const author=await env.DB.prepare('SELECT author_id FROM messages WHERE id=?').bind(messageId).first<{author_id:string|null}>();
    for(const setting of settings.results){
      if(setting.mode==='none')notified.delete(setting.user_id);
      if(setting.mode==='all'&&setting.user_id!==author?.author_id)notified.add(setting.user_id);
    }
  }
  await env.DB.batch(userIds.map(id=>env.DB.prepare('INSERT INTO events(user_id,kind,message_id,channel_id,dm_id,notifiable) VALUES(?,?,?,?,?,?)').bind(id,kind,messageId,channelId,dmId,notified.has(id)?1:0)));
  if(notified.size){try{await env.LIVE.get(env.LIVE.idFromName('__digest__')).fetch('https://live/digest/ensure',{method:'POST'});}catch(error){console.error('Digest scheduler failed',error instanceof Error?error.message:'unknown error');}}
  const live=await Promise.allSettled(userIds.map(id=>env.LIVE.get(env.LIVE.idFromName(id)).fetch('https://live/event',{method:'POST',body:JSON.stringify({kind,messageId,channelId,dmId})})));
  await Promise.allSettled(userIds.filter(id=>notified.has(id)).map(async id=>{
    const index=userIds.indexOf(id);const result=live[index];
    const count=result.status==='fulfilled'?(await result.value.json() as {connections:number}).connections:0;
    if(count===0)await sendPush(env,id);
  }));
  if(env.EVENTS_QUEUE) await env.EVENTS_QUEUE.send({kind,messageId,channelId,dmId});
}
async function messageList(c:Context<Bindings>, column:'channel_id'|'dm_id', id:string, root:string|null) {
  const before=asId(c.req.query('before')); const after=asId(c.req.query('after'));
  const condition=before?'AND m.id<?':after?'AND m.id>?':'';
  const order=after?'ASC':'DESC'; const args=[id,root]; if(before||after) args.push(before||after);
  const rows=await c.env.DB.prepare(`SELECT m.*,u.name author_name,u.affiliation author_affiliation,(SELECT json_group_array(user_id) FROM message_addressees WHERE message_id=m.id) addressees,(SELECT json_group_object(user_id,status) FROM message_addressees WHERE message_id=m.id) addressee_status,(SELECT json_group_array(json_object('user_id',user_id,'kind',kind)) FROM reactions WHERE message_id=m.id) reactions,(SELECT json_group_array(json_object('id',id,'filename',filename,'bytes',bytes,'omitted',omitted)) FROM attachments WHERE message_id=m.id) attachment_list FROM messages m LEFT JOIN users u ON u.id=m.author_id WHERE m.${column}=? AND m.thread_root_id IS ? AND m.deleted_at IS NULL ${condition} ORDER BY m.id ${order} LIMIT 51`).bind(...args).all();
  const hasMore=rows.results.length>50; const messages=rows.results.slice(0,50);
  if(!after) messages.reverse();
  return c.json({messages,hasMore,cursor:messages.length?messages[0].id:null});
}
async function canAccessDm(env:Env,user:Viewer,dmId:string):Promise<boolean>{
  if(!await env.DB.prepare('SELECT 1 FROM dm_members WHERE dm_id=? AND user_id=?').bind(dmId,user.id).first())return false;
  if(user.role==='admin')return true;
  const mine=await spacesFor(env,user);if(!mine.length)return false;
  const others=await env.DB.prepare('SELECT u.id,u.email,u.name,u.role,u.affiliation FROM dm_members dm JOIN users u ON u.id=dm.user_id WHERE dm.dm_id=? AND dm.user_id<>?').bind(dmId,user.id).all<Viewer>();
  for(const other of others.results){if(!(await spacesFor(env,other)).some(space=>mine.includes(space)))return false;}
  return true;
}
app.get('/api/dms',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');
  const rows=await c.env.DB.prepare('SELECT d.id,group_concat(u.name, ", ") names FROM dm_conversations d JOIN dm_members mine ON mine.dm_id=d.id AND mine.user_id=? JOIN dm_members others ON others.dm_id=d.id AND others.user_id<>? JOIN users u ON u.id=others.user_id GROUP BY d.id ORDER BY d.created_at DESC').bind(user.id,user.id).all<{id:string;names:string}>();
  const accessible=[];for(const row of rows.results)if(await canAccessDm(c.env,user,row.id))accessible.push(row);
  return c.json({dms:accessible});
});
app.post('/api/dms',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');
  const body=await input(c);const targetIds=Array.isArray(body.userIds)?[...new Set(body.userIds.map(asId).filter(Boolean))].filter(id=>id!==user.id):[];
  if(!targetIds.length||targetIds.length>4)return jsonError(c,400,'相手を1〜4人選択してください');
  const mine=await spacesFor(c.env,user);
  for(const id of targetIds){const target=await c.env.DB.prepare('SELECT id,email,name,role,affiliation FROM users WHERE id=?').bind(id).first<Viewer>();
    if(!target)return jsonError(c,404,'相手が見つかりません');
    if(user.role!=='admin'){const theirs=await spacesFor(c.env,target);if(!mine.some(s=>theirs.includes(s)))return jsonError(c,403,'共有スペースがありません');}
  }
  const memberIds=[user.id,...targetIds].sort();
  const existing=await c.env.DB.prepare('SELECT dm_id,group_concat(user_id) member_ids FROM dm_members GROUP BY dm_id HAVING COUNT(*)=?').bind(memberIds.length).all<{dm_id:string;member_ids:string}>();
  const match=existing.results.find(row=>row.member_ids.split(',').sort().join(',')===memberIds.join(','));
  if(match)return c.json({id:match.dm_id});
  const id=createId();await c.env.DB.batch([c.env.DB.prepare('INSERT INTO dm_conversations(id) VALUES(?)').bind(id),...memberIds.map(uid=>c.env.DB.prepare('INSERT INTO dm_members(dm_id,user_id) VALUES(?,?)').bind(id,uid))]);
  return c.json({id},201);
});
app.get('/api/dms/:id/messages',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');const id=asId(c.req.param('id'));
  if(!await canAccessDm(c.env,user,id))return jsonError(c,404,'見つかりません');
  return messageList(c,'dm_id',id,asId(c.req.query('thread'))||null);
});
app.post('/api/dms/:id/messages',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');const dmId=asId(c.req.param('id'));
  if(!await canAccessDm(c.env,user,dmId))return jsonError(c,404,'見つかりません');
  const body=await input(c);const parsed=parseIntent(clean(body.body,10000));const intent=(body.intent||parsed.intent) as Intent|null;
  if(!parsed.body)return jsonError(c,400,'本文が必要です');if(intent&&!['ACTION','SIGN','INFO','DECISION','REQUEST','COORD'].includes(intent))return jsonError(c,400,'タグを確認してください');
  const members=await c.env.DB.prepare('SELECT user_id id FROM dm_members WHERE dm_id=?').bind(dmId).all<{id:string}>();const ids=members.results.map(r=>r.id);
  const recipients=ids.filter(id=>id!==user.id);const id=await allocateMessageId(c.env);
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO messages(id,dm_id,author_id,body,intent,intent_source) VALUES(?,?,?,?,?,?)').bind(id,dmId,user.id,parsed.body,intent,intent?'human':null),...(intent&&intent!=='INFO'?recipients.map(uid=>c.env.DB.prepare('INSERT INTO message_addressees(message_id,user_id) VALUES(?,?)').bind(id,uid)):[])]);
  await emit(c.env,ids,'message',id,null,dmId,recipients);return c.json({id},201);
});
app.get('/api/channels/:id/messages',async c=>{
  const user=await viewer(c); if(!user)return jsonError(c,401,'ログインしてください');
  const channel=await canAccessChannel(c.env,user,c.req.param('id')); if(!channel)return jsonError(c,404,'見つかりません');
  return messageList(c,'channel_id',channel.id,asId(c.req.query('thread'))||null);
});
app.post('/api/channels/:id/messages',async c=>{
  const user=await viewer(c); if(!user)return jsonError(c,401,'ログインしてください');
  const channel=await canAccessChannel(c.env,user,c.req.param('id')); if(!channel)return jsonError(c,404,'見つかりません');
  const body=await input(c); const parsed=parseIntent(clean(body.body,10000)); const intent=(body.intent||parsed.intent) as Intent|null;
  if(!parsed.body) return jsonError(c,400,'本文が必要です');
  if(intent && !['ACTION','SIGN','INFO','DECISION','REQUEST','COORD'].includes(intent)) return jsonError(c,400,'タグを確認してください');
  const due=clean(body.dueDate,10)||null; if(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due))return jsonError(c,400,'日付を確認してください');
  const root=asId(body.threadRootId)||null;
  if(root){const parent=await c.env.DB.prepare('SELECT id FROM messages WHERE id=? AND channel_id=? AND thread_root_id IS NULL').bind(root,channel.id).first();if(!parent)return jsonError(c,404,'スレッドが見つかりません');}
  const participants=await channelParticipants(c.env,channel.space_id);
  const mentions=Array.isArray(body.mentions)?[...new Set(body.mentions.map(asId).filter(Boolean))].filter(id=>participants.includes(id)&&id!==user.id):[];
  const actionable=!!intent&&intent!=='INFO'; const recipients=actionable?(mentions.length?mentions:participants.filter(id=>id!==user.id)):[];
  const id=await allocateMessageId(c.env);
  const statements=[c.env.DB.prepare('INSERT INTO messages(id,channel_id,thread_root_id,author_id,body,intent,intent_source,due_date,broadcast) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,channel.id,root,user.id,parsed.body,intent,intent?'human':null,due,actionable&&!mentions.length?1:0),c.env.DB.prepare('INSERT INTO messages_fts(body,message_id,channel_id) VALUES(?,?,?)').bind(parsed.body,id,channel.id),...recipients.map(uid=>c.env.DB.prepare('INSERT INTO message_addressees(message_id,user_id) VALUES(?,?)').bind(id,uid)),...mentions.map(uid=>c.env.DB.prepare('INSERT INTO message_mentions(message_id,user_id) VALUES(?,?)').bind(id,uid))];
  await c.env.DB.batch(statements);
  const notified=[...new Set([...mentions,...recipients])];
  if(root){const threadPeople=await c.env.DB.prepare('SELECT DISTINCT author_id id FROM messages WHERE (id=? OR thread_root_id=?) AND author_id IS NOT NULL').bind(root,root).all<{id:string}>();for(const person of threadPeople.results)if(person.id!==user.id)notified.push(person.id);}
  const external=root?await c.env.DB.prepare('SELECT external_email,mail_subject,mail_message_id,mail_references FROM messages WHERE id=?').bind(root).first<{external_email:string|null;mail_subject:string|null;mail_message_id:string|null;mail_references:string|null}>():null;
  let emailSent=true;
  if(external?.external_email){
    const intentName:Record<Intent,string>={ACTION:'行動',SIGN:'承認',INFO:'情報',DECISION:'決断',REQUEST:'要求',COORD:'調整'};
    const subject=`${intent?`【${intentName[intent]}】`:''}Re: ${external.mail_subject||'TheChat'}`;
    const headers:Record<string,string>={};
    if(external.mail_message_id)headers['In-Reply-To']=external.mail_message_id;
    const references=[external.mail_references,external.mail_message_id].filter(Boolean).join(' ');
    if(references)headers.References=references;
    try{await sendMail(c.env,external.external_email,subject,parsed.body,headers);}catch{emailSent=false;}
  }
  await emit(c.env,participants,'message',id,channel.id,null,notified);
  return c.json({id,body:parsed.body,intent,recipients,emailSent},201);
});
app.get('/api/inbox',async c=>{
  const user=await viewer(c); if(!user)return jsonError(c,401,'ログインしてください');
  const spaces=await spacesFor(c.env,user);
  const tab=clean(c.req.query('tab'),20)||'pending';
  const mentions=tab==='mentions'||tab==='info';
  const join=mentions?'JOIN message_mentions a ON a.message_id=m.id AND a.user_id=?':'LEFT JOIN message_addressees a ON a.message_id=m.id AND a.user_id=?';
  const clause=tab==='done'?"(a.status IN ('done','rejected') OR (m.author_id=? AND m.intent IS NOT NULL AND m.intent<>'INFO' AND m.status IN ('done','rejected')))":tab==='pending'?"a.status IN ('pending','thinking')":tab==='info'?"m.intent='INFO'":'1=1';
  const allowed=spaces.length?`ch.space_id IN (${spaces.map(()=>'?').join(',')})`:'0';
  const rows=await c.env.DB.prepare(`SELECT m.*,u.name author_name,ch.name channel_name,s.name space_name,(SELECT json_group_array(user_id) FROM message_addressees WHERE message_id=m.id) addressees,(SELECT json_group_object(user_id,status) FROM message_addressees WHERE message_id=m.id) addressee_status,${mentions?'a.read_at':'NULL'} mention_read_at FROM messages m ${join} LEFT JOIN users u ON u.id=m.author_id LEFT JOIN channels ch ON ch.id=m.channel_id LEFT JOIN spaces s ON s.id=ch.space_id WHERE ${clause} AND m.deleted_at IS NULL AND ((ch.archived=0 AND ${allowed}) OR (m.dm_id IS NOT NULL AND EXISTS(SELECT 1 FROM dm_members dm WHERE dm.dm_id=m.dm_id AND dm.user_id=?))) ORDER BY (m.due_date IS NULL),m.due_date ASC,m.id DESC LIMIT 100`).bind(user.id,...(tab==='done'?[user.id]:[]),...spaces,user.id).all();
  const visible=[];for(const row of rows.results)if(!row.dm_id||await canAccessDm(c.env,user,String(row.dm_id)))visible.push(row);
  return c.json({items:visible});
});
app.get('/api/unread',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');
  const rows=await c.env.DB.prepare("SELECT e.channel_id channelId,e.dm_id dmId,count(*) count FROM events e LEFT JOIN channels ch ON ch.id=e.channel_id LEFT JOIN spaces s ON s.id=ch.space_id WHERE e.user_id=? AND e.read_at IS NULL AND e.kind='message' AND (e.channel_id IS NULL OR (ch.archived=0 AND s.archived=0)) GROUP BY e.channel_id,e.dm_id").bind(user.id).all();
  return c.json({counts:rows.results});
});
app.get('/api/notifications',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');
  const spaces=await spacesFor(c.env,user);const allowed=spaces.length?`ch.space_id IN (${spaces.map(()=>'?').join(',')})`:'0';
  const rows=await c.env.DB.prepare(`SELECT e.id event_id,e.kind,m.*,(SELECT json_group_array(user_id) FROM message_addressees WHERE message_id=m.id) addressees,(SELECT json_group_object(user_id,status) FROM message_addressees WHERE message_id=m.id) addressee_status,ch.name channel_name,s.name space_name,u.name author_name FROM events e JOIN messages m ON m.id=e.message_id LEFT JOIN channels ch ON ch.id=e.channel_id LEFT JOIN spaces s ON s.id=ch.space_id LEFT JOIN users u ON u.id=m.author_id WHERE e.user_id=? AND e.notifiable=1 AND e.read_at IS NULL AND m.deleted_at IS NULL AND ((ch.archived=0 AND ${allowed}) OR e.dm_id IS NOT NULL) ORDER BY e.id DESC LIMIT 50`).bind(user.id,...spaces).all<{dm_id:string|null}>();
  const items=[];for(const row of rows.results)if(!row.dm_id||await canAccessDm(c.env,user,row.dm_id))items.push(row);
  return c.json({items});
});
app.post('/api/read',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');
  const body=await input(c);const channelId=asId(body.channelId);const dmId=asId(body.dmId);const lastId=asId(body.lastId);
  if(!lastId||(!channelId&&!dmId))return jsonError(c,400,'既読位置が必要です');
  if(channelId&&!await canAccessChannel(c.env,user,channelId))return jsonError(c,404,'見つかりません');
  if(dmId&&!await canAccessDm(c.env,user,dmId))return jsonError(c,404,'見つかりません');
  await c.env.DB.prepare(`UPDATE events SET read_at=? WHERE user_id=? AND ${channelId?'channel_id':'dm_id'}=? AND message_id<=? AND read_at IS NULL`).bind(Date.now(),user.id,channelId||dmId,lastId).run();
  await c.env.DB.prepare('UPDATE message_mentions SET read_at=? WHERE user_id=? AND message_id<=? AND message_id IN (SELECT id FROM messages WHERE channel_id=?)').bind(Date.now(),user.id,lastId,channelId||'').run();
  return c.json({ok:true});
});
app.post('/api/messages/:id/respond',async c=>{
  const user=await viewer(c); if(!user)return jsonError(c,401,'ログインしてください');
  const body=await input(c);const status=clean(body.status,20);
  if(!['thinking','done','rejected'].includes(status))return jsonError(c,400,'応答を確認してください');
  const message=await c.env.DB.prepare('SELECT * FROM messages WHERE id=? AND deleted_at IS NULL').bind(c.req.param('id')).first<{id:string;channel_id:string|null;dm_id:string|null;broadcast:number;intent:string;author_id:string}>();
  if(!message)return jsonError(c,404,'見つかりません');
  if(message.channel_id&&!await canAccessChannel(c.env,user,message.channel_id))return jsonError(c,404,'見つかりません');
  if(message.dm_id&&!await canAccessDm(c.env,user,message.dm_id))return jsonError(c,404,'見つかりません');
  const addressee=await c.env.DB.prepare('SELECT status FROM message_addressees WHERE message_id=? AND user_id=?').bind(message.id,user.id).first<{status:string}>();
  if(!addressee)return jsonError(c,403,'宛先ではありません');
  if(!['pending','thinking'].includes(addressee.status))return jsonError(c,409,'すでに応答しています');
  if(status==='rejected'&&!['SIGN','REQUEST'].includes(message.intent))return jsonError(c,400,'このタグは否決できません');
  await c.env.DB.prepare('UPDATE message_addressees SET status=?,responded_at=? WHERE message_id=? AND user_id=?').bind(status,Date.now(),message.id,user.id).run();
  if(message.broadcast&&status!=='thinking')await c.env.DB.prepare("UPDATE message_addressees SET status=?,responded_at=? WHERE message_id=? AND status IN ('pending','thinking')").bind(status,Date.now(),message.id).run();
  const states=await c.env.DB.prepare('SELECT status FROM message_addressees WHERE message_id=?').bind(message.id).all<{status:string}>();
  const overall=states.results.some(r=>r.status==='rejected')?'rejected':states.results.every(r=>r.status==='done')?'done':'pending';
  await c.env.DB.prepare('UPDATE messages SET status=? WHERE id=?').bind(overall,message.id).run();
  const note=clean(body.comment,2000);
  if(note){const id=await allocateMessageId(c.env);await c.env.DB.prepare('INSERT INTO messages(id,channel_id,dm_id,thread_root_id,author_id,body) VALUES(?,?,?,?,?,?)').bind(id,message.channel_id,message.dm_id,message.id,user.id,note).run();}
  const ids=message.channel_id?(await channelParticipants(c.env,(await c.env.DB.prepare('SELECT space_id FROM channels WHERE id=?').bind(message.channel_id).first<{space_id:string}>())!.space_id)):message.dm_id?(await c.env.DB.prepare('SELECT user_id id FROM dm_members WHERE dm_id=?').bind(message.dm_id).all<{id:string}>()).results.map(r=>r.id):[];
  await emit(c.env,ids,'response',message.id,message.channel_id,message.dm_id,message.author_id?[message.author_id]:[]);
  return c.json({status:overall});
});
app.post('/api/messages/:id/reactions',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');
  const body=await input(c);const kind=clean(body.kind,10);if(!['了解','ありがとう','要調整','考え中'].includes(kind))return jsonError(c,400,'応答を確認してください');
  const message=await c.env.DB.prepare('SELECT channel_id,dm_id FROM messages WHERE id=? AND deleted_at IS NULL').bind(c.req.param('id')).first<{channel_id:string|null;dm_id:string|null}>();
  if(!message||message.channel_id&&!await canAccessChannel(c.env,user,message.channel_id)||message.dm_id&&!await canAccessDm(c.env,user,message.dm_id))return jsonError(c,404,'見つかりません');
  const existing=await c.env.DB.prepare('SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND kind=?').bind(c.req.param('id'),user.id,kind).first();
  if(existing)await c.env.DB.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=? AND kind=?').bind(c.req.param('id'),user.id,kind).run();
  else await c.env.DB.prepare('INSERT INTO reactions(message_id,user_id,kind) VALUES(?,?,?)').bind(c.req.param('id'),user.id,kind).run();
  if(kind==='考え中'&&!existing)await c.env.DB.prepare("UPDATE message_addressees SET status='thinking' WHERE message_id=? AND user_id=? AND status='pending'").bind(c.req.param('id'),user.id).run();
  return c.json({ok:true,active:!existing});
});
app.get('/api/events',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');
  const after=Math.max(0,Number(c.req.query('after')||0)||0);
  const rows=await c.env.DB.prepare('SELECT id,kind,message_id messageId,channel_id channelId,dm_id dmId FROM events WHERE user_id=? AND id>? ORDER BY id ASC LIMIT 200').bind(user.id,after).all();
  return c.json({events:rows.results});
});
app.get('/api/search',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');
  const q=clean(c.req.query('q'),80);if(!q)return c.json({items:[]});
  const ids=await spacesFor(c.env,user);if(!ids.length)return c.json({items:[]});
  const rows=await c.env.DB.prepare(`SELECT m.id,m.body,m.channel_id,ch.name channel_name FROM messages_fts f JOIN messages m ON m.id=f.message_id JOIN channels ch ON ch.id=m.channel_id WHERE messages_fts MATCH ? AND ch.archived=0 AND ch.space_id IN (${ids.map(()=>'?').join(',')}) AND m.deleted_at IS NULL LIMIT 50`).bind(`"${q.replaceAll('"','')}"`,...ids).all();
  return c.json({items:rows.results});
});
app.get('/api/attachments/:id',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');
  const row=await c.env.DB.prepare('SELECT a.*,m.channel_id FROM attachments a JOIN messages m ON m.id=a.message_id WHERE a.id=?').bind(c.req.param('id')).first<{r2_key:string;filename:string;media_type:string;channel_id:string}>();
  if(!row||!await canAccessChannel(c.env,user,row.channel_id))return jsonError(c,404,'見つかりません');
  const object=await c.env.FILES.get(row.r2_key);if(!object)return jsonError(c,404,'見つかりません');
  return new Response(object.body,{headers:{'Content-Type':row.media_type||'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,'X-Content-Type-Options':'nosniff'}});
});
app.get('/api/messages/:id/original',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');
  const row=await c.env.DB.prepare('SELECT m.channel_id,m.dm_id,o.body FROM mail_originals o JOIN messages m ON m.id=o.message_id WHERE m.id=? AND m.deleted_at IS NULL').bind(c.req.param('id')).first<{channel_id:string|null;dm_id:string|null;body:string}>();
  if(!row||row.channel_id&&!await canAccessChannel(c.env,user,row.channel_id)||row.dm_id&&!await canAccessDm(c.env,user,row.dm_id))return jsonError(c,404,'見つかりません');
  return c.json({body:row.body});
});
app.get('/api/mail/received',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');
  const spaceId=asId(c.req.query('spaceId'));
  if(!spaceId||!(await spacesFor(c.env,user)).includes(spaceId))return jsonError(c,404,'スペースが見つかりません');
  const before=asId(c.req.query('before'));
  const rows=await c.env.DB.prepare(`SELECT m.*,u.name author_name,ch.name channel_name,s.name space_name,(SELECT json_group_array(user_id) FROM message_addressees WHERE message_id=m.id) addressees FROM messages m JOIN channels ch ON ch.id=m.channel_id JOIN spaces s ON s.id=ch.space_id LEFT JOIN users u ON u.id=m.author_id WHERE ch.space_id=? AND ch.archived=0 AND m.source='email' AND m.deleted_at IS NULL ${before?'AND m.id<?':''} ORDER BY m.id DESC LIMIT 51`).bind(...(before?[spaceId,before]:[spaceId])).all();
  return c.json({items:rows.results.slice(0,50),cursor:rows.results.length>50?rows.results[49].id:null});
});
app.get('/api/mail/holds',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');if(user.role!=='admin')return jsonError(c,403,'管理者のみ操作できます');
  const rows=await c.env.DB.prepare('SELECT id,sender,subject,reason,received_at FROM mail_holds ORDER BY received_at DESC LIMIT 100').all();return c.json({items:rows.results});
});
app.get('/api/config',async c=>{const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');const cfg=config(c.env);return c.json({organizationName:cfg.organizationName,version:'1.0.0',fileTransferUrl:cfg.fileTransferUrl,calendarUrl:cfg.calendarUrl});});
app.get('/api/notification-settings',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');
  const row=await c.env.DB.prepare('SELECT email_enabled,email_delay_minutes FROM notification_settings WHERE user_id=?').bind(user.id).first<{email_enabled:number;email_delay_minutes:number}>();
  return c.json({emailEnabled:row?.email_enabled!==0,emailDelayMinutes:row?.email_delay_minutes??15});
});
app.post('/api/notification-settings',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');const body=await input(c);
  const delay=Number(body.emailDelayMinutes);if(typeof body.emailEnabled!=='boolean'||!Number.isInteger(delay)||delay<0||delay>1440)return jsonError(c,400,'通知設定を確認してください');
  await c.env.DB.prepare('INSERT INTO notification_settings(user_id,email_enabled,email_delay_minutes) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET email_enabled=excluded.email_enabled,email_delay_minutes=excluded.email_delay_minutes').bind(user.id,body.emailEnabled?1:0,delay).run();
  return c.json({ok:true});
});
app.get('/api/channels/:id/notification-settings',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');const channel=await canAccessChannel(c.env,user,c.req.param('id'));if(!channel)return jsonError(c,404,'見つかりません');
  const row=await c.env.DB.prepare('SELECT mode FROM channel_notification_settings WHERE user_id=? AND channel_id=?').bind(user.id,channel.id).first<{mode:string}>();return c.json({mode:row?.mode||'mentions'});
});
app.post('/api/channels/:id/notification-settings',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');const channel=await canAccessChannel(c.env,user,c.req.param('id'));if(!channel)return jsonError(c,404,'見つかりません');
  const body=await input(c);if(!['all','mentions','none'].includes(String(body.mode)))return jsonError(c,400,'通知方法を確認してください');
  await c.env.DB.prepare('INSERT INTO channel_notification_settings(user_id,channel_id,mode) VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET mode=excluded.mode').bind(user.id,channel.id,body.mode).run();return c.json({ok:true});
});
app.get('/api/push/key',async c=>{const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');return c.json({publicKey:c.env.VAPID_PUBLIC_KEY||null});});
app.post('/api/push/subscriptions',async c=>{
  const user=await viewer(c);if(!user)return jsonError(c,401,'ログインしてください');const body=await input(c);
  if(!validSubscription(body))return jsonError(c,400,'通知の登録情報を確認してください');
  await c.env.DB.prepare('INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth').bind(createId(),user.id,body.endpoint,body.keys.p256dh,body.keys.auth).run();
  return c.json({ok:true},201);
});
