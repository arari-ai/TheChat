import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {identity} from '../src/server/identity';
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
