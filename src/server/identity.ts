import {createRp,externalLocalAllowed,type RpEnvironment} from '@arari/theid-rp';
import type {Env} from './env';
import {config} from './env';
export function identityEnvironment(env:Env):RpEnvironment {
 return {DB:env.DB,APP_ORIGIN:config(env).appOrigin||'https://standalone.invalid',THEID_MODE:env.THEID_MODE,THEID_ISSUER:env.THEID_ISSUER,THEID_CLIENT_ID:env.THEID_CLIENT_ID,THEID_APP_ID:env.THEID_APP_ID,THEID_CLIENT_SECRET:env.THEID_CLIENT_SECRET,THEID_AUTH_POLICY:env.THEID_AUTH_POLICY,LOCAL_AUTH:env.LOCAL_AUTH};
}
export function identity(env:Env) {
 if((env.THEID_MODE??'local')!=='local'&&!config(env).appOrigin)throw new Error('SSO requires appOrigin');
 return createRp(identityEnvironment(env),{
  all:async()=>{const rows=await env.DB.prepare('SELECT id,name,email,disabled_at FROM users').all<{id:string;name:string;email:string;disabled_at:string|null}>();return rows.results.map(row=>({...row,active:!row.disabled_at}));},
  one:async(id)=>{const row=await env.DB.prepare('SELECT id,name,email,disabled_at FROM users WHERE id=?').bind(id).first<{id:string;name:string;email:string;disabled_at:string|null}>();return row?{...row,active:!row.disabled_at}:null;},
 });
}
export async function nativeAllowed(env:Env,id:string,role:string) {
 try {
  if((env.THEID_MODE??'local')==='local')return true;
  return role==='guest'?await externalLocalAllowed(identityEnvironment(env),id):await identity(env).localAllowed(id);
 }catch{return false;}
}
export async function identityRoute(request:Request,env:Env):Promise<Response|null> {
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/_theid/')&&!path.startsWith('/api/auth/oidc/'))return null;
 try{return await identity(env).handle(request);}catch{return Response.json({error:'本人確認を完了できませんでした'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
