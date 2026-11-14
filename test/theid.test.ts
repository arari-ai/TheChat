import {readFile,readdir} from "node:fs/promises";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {beforeAll,afterAll,it,expect} from "vitest";
import {getViewer,sha256,getConnection,authorizeConnection} from "../src/server/auth";
import {identity} from "../src/server/identity";
import {app} from "../src/server/api";
import type {Env} from "../src/server/env";
let mf:Miniflare, db:any, env:Env;
beforeAll(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:"2026-11-08",d1Databases:["DB"]}));
 db=await mf.getD1Database("DB");
 for(const name of (await readdir("migrations")).filter(n=>n.endsWith(".sql")).sort())await db.exec((await readFile("migrations/"+name,"utf8")).split("\n").filter(l=>!l.trim().startsWith("--")).join(" "));
 env={DB:db,HUB_CONFIG:JSON.stringify({appOrigin:"https://chat.example.com"})} as Env;
 await db.exec("INSERT INTO users(id,email,name,role) VALUES('staff','staff@example.com','Staff','member'),('guest','guest@example.com','Guest','guest'),('mappedguest','mapped@example.com','Mapped guest','guest')");
 for(const id of ['staff','guest','mappedguest'])await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha256(id),id,Date.now()+300000).run();
});
afterAll(async()=>{await mf?.dispose()});
const req=(id:string)=>new Request("https://chat.example.com/api/me",{headers:{Cookie:"thechat_session="+id}});
const configured=()=>({...env,THEID_MODE:"hybrid",THEID_ISSUER:"https://id.example.com/api/auth",THEID_CLIENT_ID:"fixture",THEID_APP_ID:"chat",THEID_CLIENT_SECRET:"fixture-only"}) as Env;
it("standalone uses original sessions and roles with no provider configuration",async()=>{
 expect((await getViewer(req('staff'),env))?.role).toBe('member');
 const session=(await getConnection(req('guest'),env))!;
 expect(JSON.stringify(session.context)).not.toContain('thechat_session');
 expect((await authorizeConnection(session.context,env))?.role).toBe('guest');
 await db.prepare('DELETE FROM sessions WHERE user_id=?').bind('guest').run();
 expect(await authorizeConnection(session.context,env)).toBeNull();
 await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha256('guest'),'guest',Date.now()+300000).run();
});
it("keeps unmanaged guests with incomplete/oidc settings and fails closed for staff",async()=>{
 const partial={...env,THEID_MODE:'oidc'} as Env;
 expect((await getViewer(req('guest'),partial))?.role).toBe('guest');
 expect(await getViewer(req('staff'),partial)).toBeNull();
});
it("blocks old HTTP and already-open native socket sessions for mapped staff/guests even after unlink",async()=>{
 const cfg=configured();
 const native=(await getConnection(req('mappedguest'),cfg))!;
 for(const [i,id] of ['staff','mappedguest'].entries())await identity(cfg).receive({id:'grant-'+id,kind:'grant',revision:1,subject:'person-'+i,local_member_id:id,principal_revision:1,grant_revision:1,enabled:true});
 expect(await getViewer(req('staff'),cfg)).toBeNull();
 expect(await authorizeConnection(native.context,cfg)).toBeNull();
 expect(await getViewer(req('mappedguest'),cfg)).toBeNull();
 await identity(cfg).receive({id:'remove-mappedguest',kind:'grant',revision:2,subject:'person-1',local_member_id:null,principal_revision:1,grant_revision:2,enabled:false});
 expect(await getViewer(req('mappedguest'),cfg)).toBeNull();
 expect((await getViewer(req('guest'),cfg))?.role).toBe('guest');
 const r=await app.request('https://chat.example.com/api/auth/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'staff@example.com'})},cfg);
 expect(r.status).toBe(200);
 expect(await db.prepare('SELECT 1 FROM login_codes WHERE email=?').bind('staff@example.com').first()).toBeNull();
});
it("an old valid email code cannot mutate an invitation or create a native session after mapping",async()=>{
 const cfg=configured(), code='123456';
 await db.prepare('INSERT INTO login_codes(email,code_hash,expires_at,attempts,requested_at) VALUES(?,?,?,?,?)').bind('staff@example.com',await sha256('staff@example.com:'+code),Date.now()+60000,0,Date.now()).run();
 const r=await app.request('https://chat.example.com/api/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'staff@example.com',code})},cfg);
 expect(r.status).toBe(403);
 expect(r.headers.get('set-cookie')).toBeNull();
});
