import {createProvisioningReceiver,type NativeAccount} from '@arari/hrm-provisioning';
import type {Env} from './env';
export function createChatProvisioningReceiver(env:Env){
 const db=env.DB;
 const account=(r:{id:string;email:string;name:string;role:string;disabled_at:string|null;subject?:string|null}):NativeAccount=>({id:r.id,email:r.email,name:r.name,role:r.role,active:r.disabled_at===null,identitySubject:r.subject});
 const select='SELECT a.id,a.email,a.name,a.role,a.disabled_at,l.subject FROM users a LEFT JOIN theid_identity_links l ON l.member_id=a.id AND l.current_binding=1';
 return createProvisioningReceiver({DB:db,enabled:env.PROVISIONING_ENABLED==='true',allowedOrigin:env.PROVISION_ALLOWED_ORIGIN??'',sourceId:env.PROVISION_SOURCE_ID??'',appId:'chat',identityMode:(env.THEID_MODE??'local')==='local'?'local':'theid',roles:[{id:'member',label:'一般利用者',privileged:false},{id:'admin',label:'管理者',privileged:true}]},{
  one:async id=>{const r=await db.prepare(select+' WHERE a.id=?').bind(id).first<Parameters<typeof account>[0]>();return r?account(r):null},
  byEmail:async email=>{const r=await db.prepare(select+' WHERE lower(a.email)=?').bind(email).first<Parameters<typeof account>[0]>();return r?account(r):null},
  create:(id,input)=>[db.prepare('INSERT INTO users(id,email,name,role) VALUES(?,?,?,?)').bind(id,input.account_email,input.name,input.role)],
  stop:(a,at)=>[
   db.prepare("UPDATE users SET disabled_at=? WHERE id=? AND disabled_at IS NULL AND (role<>'admin' OR (SELECT count(*) FROM users WHERE role='admin' AND disabled_at IS NULL)>1)").bind(new Date(at).toISOString(),a.id),
   db.prepare('INSERT INTO hrm_provision_assert SELECT CASE WHEN EXISTS(SELECT 1 FROM users WHERE id=? AND disabled_at IS NOT NULL) THEN 1 ELSE 0 END').bind(a.id),
   db.prepare('DELETE FROM sessions WHERE user_id=?').bind(a.id),db.prepare('DELETE FROM login_codes WHERE email=?').bind(a.email),db.prepare('UPDATE invitations SET expires_at=0 WHERE lower(email)=? AND accepted_at IS NULL').bind(a.email),db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').bind(a.id),
  ],
 });
}
