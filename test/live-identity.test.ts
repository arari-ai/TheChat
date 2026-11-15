import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {identity,identityRoute} from '../src/server/identity';
import {sha256} from '../src/server/auth';
import type {Env} from '../src/server/env';
let mf:Miniflare,db:any,env:Env;
beforeAll(async()=>{
 const bundle=await build({entryPoints:['src/server/worker.ts'],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:*']});
 const vars={HUB_CONFIG:JSON.stringify({appOrigin:'https://chat.example.com'}),THEID_MODE:'hybrid',THEID_ISSUER:'https://id.example.com/api/auth',THEID_CLIENT_ID:'fixture',THEID_APP_ID:'chat',THEID_CLIENT_SECRET:'fixture-only'};
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-08',d1Databases:['DB'],durableObjects:{LIVE:{className:'UserLive',useSQLite:true}},bindings:vars}));
 db=await mf.getD1Database('DB');
 for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec((await readFile('migrations/'+name,'utf8')).split('\n').filter(l=>!l.trim().startsWith('--')).join(' '));
 env={DB:db,...vars} as Env;
 await db.exec("INSERT INTO users(id,email,name,role) VALUES('live','live@example.com','Live','member'),('native','native@example.com','Native','guest')");
 await identity(env).receive({id:'live-grant',kind:'grant',revision:1,subject:'person',local_member_id:'live',principal_revision:1,grant_revision:1,enabled:true});
 const key=await sha256('synthetic-cookie');
 await db.prepare('INSERT INTO theid_login_sessions(id,member_id,expires_at) VALUES(?,?,?)').bind(key,'live',Date.now()+300000).run();
 await db.prepare('INSERT INTO theid_identity_sessions(session_id,issuer,audience,subject,sid,local_member_id,principal_revision,grant_revision,checked_at,valid_until) VALUES(?,?,?,?,?,?,1,1,?,?)').bind(key,vars.THEID_ISSUER,'fixture','person','sid','live',Date.now(),Date.now()+300000).run();
 await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha256('native'),'native',Date.now()+300000).run();
});
afterAll(async()=>{await mf?.dispose()});
async function connect(cookie:string){
 const response=await mf.dispatchFetch('https://chat.example.com/api/live',{headers:{Upgrade:'websocket',Origin:'https://chat.example.com',Cookie:cookie}});
 expect(response.status).toBe(101);const ws=response.webSocket!;ws.accept();return ws;
}
it('checks a live SSO socket again before sending data after stop',async()=>{
 const ws=await connect('theid_session=synthetic-cookie');
 const received:string[]=[];ws.addEventListener('message',e=>received.push(String(e.data)));
 const ns=await mf.getDurableObjectNamespace('LIVE');const live=ns.get(ns.idFromName('live'));
 await (await live.fetch('https://internal/broadcast',{method:'POST',body:'before'})).json();
 await new Promise(r=>setTimeout(r,30));expect(received).toEqual(['before']);
 await identity(env).receive({id:'live-stop',kind:'grant',revision:2,subject:'person',local_member_id:'live',principal_revision:1,grant_revision:2,enabled:false});
 const broadcast=await (await live.fetch('https://internal/broadcast',{method:'POST',body:'MUST NOT LEAK'})).json() as {connections:number};
 expect(broadcast.connections).toBe(0);
 await new Promise(r=>setTimeout(r,30));expect(received).toEqual(['before']);
 ws.close(1000);

});
it('rejects a valid connection for a different routed user after credentials change',async()=>{
 const ns=await mf.getDurableObjectNamespace('LIVE');const wrong=ns.get(ns.idFromName('other-user'));
 const r=await wrong.fetch('https://chat.example.com/api/live',{headers:{Upgrade:'websocket',Cookie:'thechat_session=native'}});
 expect(r.status).toBe(401);
});
it('checks a native guest socket on ping after native logout',async()=>{
 const ws=await connect('thechat_session=native');
 const closed=new Promise<number>(resolve=>ws.addEventListener('close',e=>resolve(e.code),{once:true}));
 await db.prepare('DELETE FROM sessions WHERE user_id=?').bind('native').run();ws.send('ping');
 expect(await Promise.race([closed,new Promise(r=>setTimeout(()=>r('timeout'),500))])).toBe(4001);
});
it('rejects a cross-site WebSocket upgrade',async()=>{
 const r=await mf.dispatchFetch('https://chat.example.com/api/live',{headers:{Upgrade:'websocket',Origin:'https://attacker.example',Cookie:'thechat_session=native'}});
 expect([401,403]).toContain(r.status);
});

async function competingIdentities(){
 const suffix=crypto.randomUUID(),staff='sso-'+suffix,native='native-'+suffix,token='sso-cookie-'+suffix,now=Date.now();
 await db.prepare("INSERT INTO users(id,email,name,role) VALUES(?,?,?,'member'),(?,?,?,'admin')").bind(staff,staff+'@example.com','SSO',native,native+'@example.com','Native admin').run();
 await identity(env).receive({id:'grant-'+suffix,kind:'grant',revision:1,subject:staff,local_member_id:staff,principal_revision:1,grant_revision:1,enabled:true});
 const key=await sha256(token);
 await db.prepare('INSERT INTO theid_login_sessions(id,member_id,expires_at) VALUES(?,?,?)').bind(key,staff,now+300000).run();
 await db.prepare('INSERT INTO theid_identity_sessions(session_id,issuer,audience,subject,sid,local_member_id,principal_revision,grant_revision,checked_at,valid_until) VALUES(?,?,?,?,?,?,1,1,?,?)').bind(key,env.THEID_ISSUER,'fixture',staff,'sid-'+suffix,staff,now,now+300000).run();
 await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha256(native),native,now+300000).run();
 return {staff,native,token,key,cookie:'theid_session='+token+'; thechat_session='+native};
}
it('SSO selects its native member over another native admin and never falls back after stop',async()=>{
 const s=await competingIdentities();
 const response=await mf.dispatchFetch('https://chat.example.com/api/me',{headers:{Cookie:s.cookie}});
 expect(await response.json()).toMatchObject({user:{id:s.staff,role:'member'}});
 await identity(env).receive({id:'stop-'+s.staff,kind:'grant',revision:2,subject:s.staff,local_member_id:s.staff,principal_revision:1,grant_revision:2,enabled:false});
 expect((await mf.dispatchFetch('https://chat.example.com/api/me',{headers:{Cookie:s.cookie}})).status).toBe(401);
});
it.each(['/api/auth/logout','/api/auth/oidc/logout'])('both logout URLs %s invalidate competing sessions',async(path)=>{
 const s=await competingIdentities();
 const response=await mf.dispatchFetch('https://chat.example.com'+path,{method:'POST',headers:{Origin:'https://chat.example.com',Cookie:s.cookie}});
 expect(response.status).toBe(200);expect(response.headers.get('set-cookie')).toContain('thechat_session=;');expect(response.headers.get('set-cookie')).toContain('theid_session=;');
 expect((await mf.dispatchFetch('https://chat.example.com/api/me',{headers:{Cookie:'thechat_session='+s.native}})).status).toBe(401);
 expect((await mf.dispatchFetch('https://chat.example.com/api/me',{headers:{Cookie:'theid_session='+s.token}})).status).toBe(401);
});
it('explicit native login invalidates the prior SSO browser session',async()=>{
 const s=await competingIdentities(),email=s.native+'@example.com',code='654321';
 await db.prepare('INSERT INTO login_codes(email,code_hash,expires_at,attempts,requested_at) VALUES(?,?,?,?,?)').bind(email,await sha256(email+':'+code),Date.now()+60000,0,Date.now()).run();
 const response=await mf.dispatchFetch('https://chat.example.com/api/auth/verify',{method:'POST',headers:{Origin:'https://chat.example.com','Content-Type':'application/json',Cookie:s.cookie},body:JSON.stringify({email,code})});
 expect(response.status).toBe(200);expect(response.headers.get('set-cookie')).toContain('theid_session=;');
 expect(await db.prepare('SELECT count(*) n FROM theid_login_sessions WHERE id=?').bind(s.key).first('n')).toBe(0);
});

it('native re-enable cannot revive an old SSO HTTP session or socket',async()=>{
 const s=await competingIdentities(),ws=await connect(s.cookie);await db.prepare('UPDATE users SET disabled_at=? WHERE id=?').bind('2026-11-15',s.staff).run();await db.prepare('UPDATE users SET disabled_at=NULL WHERE id=?').bind(s.staff).run();expect((await mf.dispatchFetch('https://chat.example.com/api/me',{headers:{Cookie:s.cookie}})).status).toBe(401);
 const ns=await mf.getDurableObjectNamespace('LIVE'),live=ns.get(ns.idFromName(s.staff));const result=await (await live.fetch('https://internal/broadcast',{method:'POST',body:'MUST NOT LEAK'})).json() as {connections:number};expect(result.connections).toBe(0);ws.close(1000);
});
it('rejects RP session insertion for inactive or absent users',async()=>{
 const s=await competingIdentities();await db.prepare('UPDATE users SET disabled_at=? WHERE id=?').bind('2026-11-15',s.staff).run();for(const id of [s.staff,'absent'])await expect(db.prepare('INSERT INTO theid_login_sessions VALUES(?,?,?)').bind(crypto.randomUUID(),id,Date.now()+300000).run()).rejects.toThrow();
});
it.each(['theid_session=','theid_session =','theid_session=""'])('present invalid SSO cookie %s cannot select native admin',async(invalid)=>{
 const s=await competingIdentities();expect((await mf.dispatchFetch('https://chat.example.com/api/me',{headers:{Cookie:invalid+'; thechat_session='+s.native}})).status).toBe(401);
});
it.each(['/api/auth/oidc/%6cogout','/api/auth/oidc/%63allback?code=x','/_theid/%61ccounts'])('rejects encoded fixed endpoint %s',async(path)=>{
 expect((await mf.dispatchFetch('https://chat.example.com'+path,{method:'POST',headers:{Origin:'https://chat.example.com'}})).status).toBe(400);
});
it('explicit native login clears a present empty SSO cookie',async()=>{
 const s=await competingIdentities(),email=s.native+'@example.com',code='654321';await db.prepare('INSERT INTO login_codes(email,code_hash,expires_at,attempts,requested_at) VALUES(?,?,?,?,?)').bind(email,await sha256(email+':'+code),Date.now()+60000,0,Date.now()).run();const response=await mf.dispatchFetch('https://chat.example.com/api/auth/verify',{method:'POST',headers:{Origin:'https://chat.example.com','Content-Type':'application/json',Cookie:'theid_session='},body:JSON.stringify({email,code})});expect(response.status).toBe(200);expect(response.headers.get('set-cookie')).toContain('theid_session=;');
});

it('canonical signed callback deletes the competing native session row',async()=>{
 const s=await competingIdentities(),issuer=env.THEID_ISSUER!;
 const {generateKeyPair,exportJWK,SignJWT}=await import('jose');const pair=await generateKeyPair('RS256',{extractable:true}),jwk={...await exportJWK(pair.publicKey),kid:crypto.randomUUID(),alg:'RS256',use:'sig'};let nonce='';
 const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{
  const url=new URL(typeof input==='string'?input:input instanceof Request?input.url:input.toString());
  if(url.pathname.endsWith('/jwks'))return Response.json({keys:[jwk]});
  if(url.pathname.endsWith('/oauth2/token')){const id_token=await new SignJWT({nonce,sid:'callback-sid',theid:{app_id:'chat',local_member_id:s.staff,principal_revision:1,grant_revision:1}}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience('fixture').setSubject(s.staff).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);return Response.json({id_token,access_token:'synthetic',token_type:'Bearer',expires_in:300});}
  if(url.pathname==='/api/identity/status')return Response.json({issuer,audience:'fixture',subject:s.staff,sid:'callback-sid',local_member_id:s.staff,principal_revision:1,grant_revision:1,enabled:true,checked_at:Date.now(),valid_until:Date.now()+300000});
  throw Error('Unexpected fixture peer');
 });
 try{
  const start=await identityRoute(new Request('https://chat.example.com/api/auth/oidc/start'),env);expect(start!.status).toBe(302);const auth=new URL(start!.headers.get('location')!);nonce=auth.searchParams.get('nonce')!;
  const callback=await identityRoute(new Request('https://chat.example.com/api/auth/oidc/callback?code=synthetic&state='+auth.searchParams.get('state')+'&iss='+encodeURIComponent(issuer),{headers:{Cookie:start!.headers.get('set-cookie')!.split(';')[0]+'; thechat_session='+s.native}}),env);expect(callback!.status).toBe(302);expect(callback!.headers.get('set-cookie')).toContain('thechat_session=;');expect(await db.prepare('SELECT count(*) n FROM sessions WHERE token_hash=?').bind(await sha256(s.native)).first('n')).toBe(0);
 }finally{spy.mockRestore();}
});
