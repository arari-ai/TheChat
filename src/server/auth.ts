import type { Env } from './env';
import { config } from './env';

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
export async function getViewer(request: Request, env: Env): Promise<Viewer|null> {
  const value = request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  if (!value || !env.DB) return null;
  return await env.DB.prepare('SELECT u.id,u.email,u.name,u.role,u.affiliation FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await sha256(value), Date.now()).first<Viewer>();
}
export async function sendMail(env: Env, to: string, subject: string, text: string, headers?: Record<string,string>): Promise<void> {
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
