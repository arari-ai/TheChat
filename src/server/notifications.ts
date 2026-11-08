import type { Env } from './env';
import { sendMail } from './auth';

export function dueForDigest(createdAt:number,delayMinutes:number,now:number):boolean {
  return now-createdAt>=Math.max(0,delayMinutes)*60000;
}
export async function sendDigests(env:Env):Promise<void>{
  const rows=await env.DB.prepare("SELECT e.id,e.user_id,u.email FROM events e JOIN users u ON u.id=e.user_id LEFT JOIN notification_settings n ON n.user_id=e.user_id LEFT JOIN channels ch ON ch.id=e.channel_id LEFT JOIN spaces s ON s.id=ch.space_id WHERE u.disabled_at IS NULL AND e.notifiable=1 AND e.read_at IS NULL AND e.emailed_at IS NULL AND (e.channel_id IS NULL OR (ch.archived=0 AND s.archived=0)) AND COALESCE(n.email_enabled,1)=1 AND e.created_at <= datetime('now', '-' || COALESCE(n.email_delay_minutes,15) || ' minutes') ORDER BY e.user_id,e.id LIMIT 500").all<{id:number;user_id:string;email:string}>();
  const groups=new Map<string,{email:string;ids:number[]}>();
  for(const row of rows.results){const group=groups.get(row.user_id)||{email:row.email,ids:[]};group.ids.push(row.id);groups.set(row.user_id,group);}
  for(const group of groups.values()){
    try{
      await sendMail(env,group.email,'TheChat 未読の連絡',`未読の連絡が${group.ids.length}件あります。\nTheChatを開いて確認してください。`);
      await env.DB.prepare(`UPDATE events SET emailed_at=? WHERE id IN (${group.ids.map(()=>'?').join(',')})`).bind(Date.now(),...group.ids).run();
    }catch(error){console.error('Digest delivery failed',error instanceof Error?error.message:'unknown error');}
  }
}
