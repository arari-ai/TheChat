import { buildPushPayload, type PushSubscription, type VapidKeys } from '@block65/webcrypto-web-push';
import { config, type Env } from './env';

export function validSubscription(value:unknown):value is PushSubscription {
  if(!value||typeof value!=='object')return false;
  const item=value as {endpoint?:unknown;keys?:{p256dh?:unknown;auth?:unknown}};
  if(typeof item.endpoint!=='string'||item.endpoint.length>2048)return false;
  try{const url=new URL(item.endpoint);if(url.protocol!=='https:'||!url.hostname.includes('.')||/^(localhost|127\.|10\.|192\.168\.|172\.)/.test(url.hostname))return false;}catch{return false;}
  return typeof item.keys?.p256dh==='string'&&/^[A-Za-z0-9_-]+$/.test(item.keys.p256dh)&&typeof item.keys?.auth==='string'&&/^[A-Za-z0-9_-]+$/.test(item.keys.auth);
}

export type PushContent={kind:string;author:string;channelName:string|null;body:string;mentioned:boolean;channelId:string|null;threadRootId:string|null;unread:number};
const BODY_LIMIT=120;

// The payload is encrypted for the receiving device (RFC 8291); the push service relays it without reading it.
export function pushMessage(content:PushContent,origin?:string):Record<string,unknown> {
  const path=content.channelId?`/?channel=${encodeURIComponent(content.channelId)}${content.threadRootId?`&thread=${encodeURIComponent(content.threadRootId)}`:''}`:'/';
  let title='TheChat',body='新しい連絡があります';
  if(content.kind==='message'){
    title=content.mentioned?`${content.author}さんがあなたをメンションしました`:`${content.author}さんからの連絡`;
    const text=`${content.channelName?`＃${content.channelName}：`:''}${content.body.replace(/\s+/g,' ').trim()}`;
    body=text.length>BODY_LIMIT?`${text.slice(0,BODY_LIMIT-1)}…`:text;
  }
  let base:string|null=null;
  try{const url=origin?new URL(origin):null;if(url?.protocol==='https:')base=url.origin;}catch{/* fall back to the plain format */}
  // Declarative Web Push (Safari 18.4+) is shown without waking the service worker; other browsers hand the same JSON to sw.js.
  if(base)return {web_push:8030,notification:{title,body,navigate:base+path,app_badge:String(content.unread),lang:'ja'}};
  return {title,body,url:path,badge:content.unread};
}

export async function pushContent(env:Env,userId:string,messageId:string,kind:string):Promise<PushContent|null> {
  const message=await env.DB.prepare("SELECT m.body,m.channel_id,m.thread_root_id,COALESCE(u.name,m.external_name,'外部の送信者') author,ch.name channel_name,EXISTS(SELECT 1 FROM message_mentions mm WHERE mm.message_id=m.id AND mm.user_id=?) mentioned FROM messages m LEFT JOIN users u ON u.id=m.author_id LEFT JOIN channels ch ON ch.id=m.channel_id WHERE m.id=? AND m.deleted_at IS NULL").bind(userId,messageId).first<{body:string;channel_id:string|null;thread_root_id:string|null;author:string;channel_name:string|null;mentioned:number}>();
  if(!message)return null;
  const unread=await env.DB.prepare('SELECT count(*) count FROM events e JOIN messages m ON m.id=e.message_id LEFT JOIN channels ch ON ch.id=e.channel_id LEFT JOIN spaces s ON s.id=ch.space_id WHERE e.user_id=? AND e.notifiable=1 AND e.read_at IS NULL AND m.deleted_at IS NULL AND (e.dm_id IS NOT NULL OR (ch.archived=0 AND s.archived=0))').bind(userId).first<{count:number}>();
  return {kind,author:message.author,channelName:message.channel_name,body:message.body,mentioned:!!message.mentioned,channelId:message.channel_id,threadRootId:message.thread_root_id,unread:unread?.count||0};
}

export async function sendPush(env:Env,userId:string,messageId:string,kind:string):Promise<void>{
  if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return;
  const vapid:VapidKeys={publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY,subject:env.VAPID_SUBJECT};
  const rows=await env.DB.prepare('SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE users.id=user_id AND disabled_at IS NULL)').bind(userId).all<{id:string;endpoint:string;p256dh:string;auth:string}>();
  if(!rows.results.length)return;
  const content=await pushContent(env,userId,messageId,kind);
  if(!content)return;
  const data=JSON.stringify(pushMessage(content,config(env).appOrigin));
  const results=await Promise.allSettled(rows.results.map(async row=>{
    const subscription:PushSubscription={endpoint:row.endpoint,expirationTime:null,keys:{p256dh:row.p256dh,auth:row.auth}};
    const payload=await buildPushPayload({data,options:{ttl:3600}},subscription,vapid);
    const response=await fetch(row.endpoint,payload);
    if(response.status===404||response.status===410)await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(row.id).run();
    else if(!response.ok)throw new Error(`push service responded ${response.status}`);
  }));
  for(const result of results)if(result.status==='rejected')console.error('Push delivery failed',result.reason instanceof Error?result.reason.message:'unknown error');
}
