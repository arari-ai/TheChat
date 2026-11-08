import {crmOutboxStatement,scheduleCrmDelivery} from './crm';
import PostalMime from 'postal-mime';
import type { Env } from './env';
import { attachmentAllowed, trustedMail } from './mail-rules';
import { allocateMessageId } from './db';
import { channelParticipants, emit } from './api';

export interface IncomingEmail { from:string; to:string; headers:Headers; raw:ReadableStream<Uint8Array> }
function plainText(text:string):string {
  return text.replace(/\nOn .+ wrote:\s*$/s,'').replace(/\n>.*(?:\n>.*)*$/s,'').replace(/\n--\s*\n[\s\S]*$/,'').trim();
}
export async function receiveMail(message:IncomingEmail,env:Env):Promise<void> {
  const channel=await env.DB.prepare('SELECT ch.id,ch.space_id,ch.mail_policy,ch.mail_allowlist FROM channels ch JOIN spaces s ON s.id=ch.space_id WHERE lower(ch.mail_address)=? AND ch.archived=0 AND s.archived=0').bind(message.to.toLowerCase()).first<{id:string;space_id:string;mail_policy:string;mail_allowlist:string}>();
  if(!channel) return;
  const auth=message.headers.get('Authentication-Results');
  const parsed=await PostalMime.parse(message.raw,{attachmentEncoding:'arraybuffer'});
  if(!trustedMail(auth,message.from,parsed.from?.address||null)) {
    await env.DB.prepare('INSERT INTO mail_holds(id,channel_id,sender,reason) VALUES(?,?,?,?)').bind(crypto.randomUUID(),channel.id,message.from,'Email authentication failed or sender addresses differ').run();
    return;
  }
  if(channel.mail_policy==='allowlist') {
    const list=JSON.parse(channel.mail_allowlist||'[]') as string[];
    const sender=message.from.toLowerCase();
    const registered=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(sender).first();
    if(!registered&&!list.some(item=>item.startsWith('@')?sender.endsWith(item.toLowerCase()):sender===item.toLowerCase())) return;
  }
  if(parsed.messageId) {
    const duplicate=await env.DB.prepare('SELECT id FROM messages WHERE mail_message_id=?').bind(parsed.messageId).first();
    if(duplicate) return;
  }
  const sender=message.from.toLowerCase();
  const user=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(sender).first<{id:string}>();
  const parentId=parsed.inReplyTo||parsed.references?.split(/\s+/).at(-1);
  const parent=parentId?await env.DB.prepare('SELECT id,thread_root_id FROM messages WHERE mail_message_id=? AND channel_id=?').bind(parentId,channel.id).first<{id:string;thread_root_id:string|null}>():null;
  const id=await allocateMessageId(env); const subject=parsed.subject||'(件名なし)';
  const text=plainText(parsed.text||'')||subject;
  const original=(parsed.text||parsed.html||'').slice(0,250000);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO messages(id,channel_id,thread_root_id,author_id,external_name,external_email,body,source,source_id,mail_subject,mail_message_id,mail_references) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,channel.id,parent?.thread_root_id||parent?.id||null,user?.id||null,user?null:parsed.from?.name||sender,user?null:sender,text,'email',parsed.messageId||null,subject,parsed.messageId||null,parsed.references||null),
    env.DB.prepare('INSERT INTO mail_originals(message_id,body) VALUES(?,?)').bind(id,original),
    crmOutboxStatement(env,id,'mail_in',sender)
  ]);
  await scheduleCrmDelivery(env);
  await env.DB.prepare('INSERT INTO messages_fts(body,message_id,channel_id) VALUES(?,?,?)').bind(text,id,channel.id).run();
  for(const part of parsed.attachments) {
    const filename=(part.filename||'attachment').slice(0,200);
    const bytes=part.content instanceof ArrayBuffer?part.content.byteLength:part.content instanceof Uint8Array?part.content.byteLength:part.content.length;
    const allowed=attachmentAllowed(bytes);const key=allowed?`mail/${id}/${crypto.randomUUID()}`:null;
    if(key) await env.FILES.put(key,part.content as ArrayBuffer);
    await env.DB.prepare('INSERT INTO attachments(id,message_id,filename,bytes,media_type,r2_key,omitted) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,filename,bytes,part.mimeType,key,allowed?0:1).run();
  }
  await emit(env,await channelParticipants(env,channel.space_id),'message',id,channel.id,null);
}
