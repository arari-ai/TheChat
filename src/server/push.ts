import { buildPushPayload, type PushSubscription, type VapidKeys } from '@block65/webcrypto-web-push';
import type { Env } from './env';

export function validSubscription(value:unknown):value is PushSubscription {
  if(!value||typeof value!=='object')return false;
  const item=value as {endpoint?:unknown;keys?:{p256dh?:unknown;auth?:unknown}};
  if(typeof item.endpoint!=='string'||item.endpoint.length>2048)return false;
  try{const url=new URL(item.endpoint);if(url.protocol!=='https:'||!url.hostname.includes('.')||/^(localhost|127\.|10\.|192\.168\.|172\.)/.test(url.hostname))return false;}catch{return false;}
  return typeof item.keys?.p256dh==='string'&&/^[A-Za-z0-9_-]+$/.test(item.keys.p256dh)&&typeof item.keys?.auth==='string'&&/^[A-Za-z0-9_-]+$/.test(item.keys.auth);
}
export async function sendPush(env:Env,userId:string):Promise<void>{
  if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return;
  const vapid:VapidKeys={publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY,subject:env.VAPID_SUBJECT};
  const rows=await env.DB.prepare('SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?').bind(userId).all<{id:string;endpoint:string;p256dh:string;auth:string}>();
  await Promise.allSettled(rows.results.map(async row=>{
    const subscription:PushSubscription={endpoint:row.endpoint,expirationTime:null,keys:{p256dh:row.p256dh,auth:row.auth}};
    const payload=await buildPushPayload({data:JSON.stringify({title:'TheChat',body:'新しい連絡があります',url:'/'}),options:{ttl:3600}},subscription,vapid);
    const response=await fetch(row.endpoint,payload);
    if(response.status===404||response.status===410)await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(row.id).run();
  }));
}
