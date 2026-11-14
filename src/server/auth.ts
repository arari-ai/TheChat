import type { Env } from './env';
import { config } from './env';
import {identity,nativeAllowed} from './identity';
import type {ConnectionContext as IdentityContext} from '@arari/theid-rp';

export interface Viewer { id: string; email: string; name: string; role: 'admin'|'member'|'guest'; affiliation: string|null }
export const cookieName = 'thechat_session';
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}
export function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
}
export type ConnectionContext = {kind:'native';sessionId:string;memberId:string}|{kind:'theid';session:IdentityContext};
function cookie(request:Request,name:string){return request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);}
export async function authorizeConnection(context:ConnectionContext,env:Env):Promise<Viewer|null> {
 try{
  if(!context||!env.DB)return null;
  if(context.kind==='native'){
   if(!/^[a-f0-9]{64}$/.test(context.sessionId))return null;
   const user=await env.DB.prepare('SELECT u.id,u.email,u.name,u.role,u.affiliation FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>? AND u.disabled_at IS NULL').bind(context.sessionId,context.memberId,Date.now()).first<Viewer>();
   return user&&await nativeAllowed(env,user.id,user.role)?user:null;
  }
  if(context.kind!=='theid')return null;
  const account=await identity(env).authorizeConnection(context.session);
  return account?await env.DB.prepare('SELECT id,email,name,role,affiliation FROM users WHERE id=? AND disabled_at IS NULL').bind(account.id).first<Viewer>():null;
 }catch{return null;}
}
export async function getConnection(request:Request,env:Env):Promise<{user:Viewer;context:ConnectionContext}|null> {
 const value=cookie(request,cookieName);
 if(value&&env.DB){
  const sessionId=await sha256(value);
  const row=await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').bind(sessionId,Date.now()).first<{user_id:string}>();
  if(row){const context={kind:'native' as const,sessionId,memberId:row.user_id};const user=await authorizeConnection(context,env);if(user)return {user,context};}
 }
 if(!cookie(request,'theid_session'))return null;
 try{
  const session=await identity(env).connection(request);
  if(!session)return null;
  const context={kind:'theid' as const,session:session.context};
  const user=await authorizeConnection(context,env);
  return user?{user,context}:null;
 }catch{return null;}
}
export async function getViewer(request:Request,env:Env):Promise<Viewer|null>{return (await getConnection(request,env))?.user??null;}
export async function sendMail(env: Env, to: string, subject: string, text: string, headers?: Record<string,string>): Promise<void> {
  if(env.DB && await env.DB.prepare('SELECT 1 FROM users WHERE email=? AND disabled_at IS NOT NULL').bind(to.toLowerCase()).first())return;
  const from = config(env).mailFrom;
  if (!from) throw new Error('mailFrom is not configured');
  if (env.EMAIL) { await env.EMAIL.send({ to, from, subject, text, headers }); return; }
  if (env.RESEND_API_KEY) {
    const result = await fetch('https://api.resend.com/emails', { method:'POST', headers:{'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'}, body:JSON.stringify({from,to,subject,text,headers}) });
    if (!result.ok) throw new Error(`Mail delivery failed: ${result.status}`);
    return;
  }
  throw new Error('Email sender is not configured');
}
export async function spacesFor(env: Env, user: Viewer): Promise<string[]> {
  const query = user.role === 'admin'
    ? 'SELECT id FROM spaces WHERE archived=0'
    : "SELECT s.id FROM spaces s LEFT JOIN space_members sm ON sm.space_id=s.id AND sm.user_id=? WHERE s.archived=0 AND (sm.user_id IS NOT NULL OR (s.all_members=1 AND ?='member'))";
  const result = user.role === 'admin' ? await env.DB.prepare(query).all<{id:string}>() : await env.DB.prepare(query).bind(user.id,user.role).all<{id:string}>();
  return result.results.map(row=>row.id);
}
export async function canAccessChannel(env: Env, user: Viewer, channelId: string): Promise<{id:string;space_id:string;name:string}|null> {
  const channel = await env.DB.prepare('SELECT id,space_id,name FROM channels WHERE id=? AND archived=0').bind(channelId).first<{id:string;space_id:string;name:string}>();
  if (!channel) return null;
  return (await spacesFor(env,user)).includes(channel.space_id) ? channel : null;
}
