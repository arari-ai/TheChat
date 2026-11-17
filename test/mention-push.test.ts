import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {app} from '../src/server/api';
import {sha256} from '../src/server/auth';
import type {Env} from '../src/server/env';
import {pushContent,pushMessage} from '../src/server/push';
import {applyBadge,vapidBytes} from '../src/client/push';

const b64=(bytes:ArrayBuffer|Uint8Array)=>Buffer.from(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes)).toString('base64url');

describe('push message format',()=>{
  const base={kind:'message',author:'佐藤',channelName:'営業',body:'  見積もりを\n確認してください  ',mentioned:true,channelId:'ch1',threadRootId:null,unread:3};
  it('names the sender and the mention, and links to the channel',()=>{
    expect(pushMessage(base)).toEqual({title:'佐藤さんがあなたをメンションしました',body:'＃営業：見積もりを 確認してください',url:'/?channel=ch1',badge:3});
  });
  it('uses the declarative format with an absolute link when the public origin is known',()=>{
    expect(pushMessage({...base,mentioned:false,threadRootId:'root1'},'https://chat.example.com')).toEqual({web_push:8030,notification:{title:'佐藤さんからの連絡',body:'＃営業：見積もりを 確認してください',navigate:'https://chat.example.com/?channel=ch1&thread=root1',app_badge:'3',lang:'ja'}});
  });
  it('ignores an origin that is not HTTPS and shortens long text',()=>{
    const message=pushMessage({...base,channelId:null,channelName:null,body:'あ'.repeat(300)},'http://chat.example.com') as {body:string;url:string};
    expect(message.url).toBe('/');expect(message.body).toHaveLength(120);expect(message.body.endsWith('…')).toBe(true);
  });
  it('keeps other notification kinds generic',()=>{
    expect(pushMessage({...base,kind:'response'})).toEqual({title:'TheChat',body:'新しい連絡があります',url:'/?channel=ch1',badge:3});
  });
});

describe('client badge and key helpers',()=>{
  it('sets the unread count and clears it at zero',()=>{
    const set=vi.fn().mockResolvedValue(undefined),clear=vi.fn().mockResolvedValue(undefined);
    applyBadge({setAppBadge:set,clearAppBadge:clear},4);expect(set).toHaveBeenCalledWith(4);
    applyBadge({setAppBadge:set,clearAppBadge:clear},0);expect(clear).toHaveBeenCalled();
    expect(()=>applyBadge({},2)).not.toThrow();
  });
  it('decodes a base64url VAPID key',()=>{expect([...vapidBytes('AQID_-8')]).toEqual([1,2,3,255,239]);});
});

describe('service worker',()=>{
  async function load(){
    const listeners:Record<string,(event:any)=>void>={};
    const scope:any={location:{origin:'https://chat.example.com'},addEventListener:(name:string,fn:(event:any)=>void)=>{listeners[name]=fn;},skipWaiting:vi.fn(),
      registration:{showNotification:vi.fn().mockResolvedValue(undefined)},navigator:{setAppBadge:vi.fn().mockResolvedValue(undefined),clearAppBadge:vi.fn().mockResolvedValue(undefined)},
      clients:{claim:vi.fn(),matchAll:vi.fn().mockResolvedValue([]),openWindow:vi.fn().mockResolvedValue(undefined)}};
    new Function('self',await readFile(new URL('../public/sw.js',import.meta.url),'utf8'))(scope);
    const dispatch=async(name:string,event:any)=>{const waits:Promise<unknown>[]=[];listeners[name]({...event,waitUntil:(p:Promise<unknown>)=>waits.push(p)});await Promise.all(waits);};
    return {scope,dispatch};
  }
  it('shows a declarative message and sets the badge',async()=>{
    const {scope,dispatch}=await load();
    await dispatch('push',{data:{json:()=>({web_push:8030,notification:{title:'佐藤さんがあなたをメンションしました',body:'＃営業：確認',navigate:'https://chat.example.com/?channel=ch1',app_badge:'2'}})}});
    expect(scope.registration.showNotification).toHaveBeenCalledWith('佐藤さんがあなたをメンションしました',expect.objectContaining({body:'＃営業：確認',data:{url:'https://chat.example.com/?channel=ch1'}}));
    expect(scope.navigator.setAppBadge).toHaveBeenCalledWith(2);
  });
  it('shows the plain format and always displays a notification for unreadable data',async()=>{
    const {scope,dispatch}=await load();
    await dispatch('push',{data:{json:()=>({title:'T',body:'B',url:'/?channel=x',badge:0})}});
    expect(scope.registration.showNotification).toHaveBeenCalledWith('T',expect.objectContaining({body:'B',data:{url:'/?channel=x'}}));
    expect(scope.navigator.clearAppBadge).toHaveBeenCalled();
    await dispatch('push',{data:{json:()=>{throw new Error('bad');}}});
    expect(scope.registration.showNotification).toHaveBeenLastCalledWith('TheChat',expect.objectContaining({body:'新しい連絡があります'}));
  });
  it('focuses an open window on click and never opens another origin',async()=>{
    const {scope,dispatch}=await load();
    const client={navigate:vi.fn().mockResolvedValue(undefined),focus:vi.fn().mockResolvedValue(undefined)};
    scope.clients.matchAll.mockResolvedValue([client]);
    await dispatch('notificationclick',{notification:{close:vi.fn(),data:{url:'/?channel=ch1'}}});
    expect(client.navigate).toHaveBeenCalledWith('https://chat.example.com/?channel=ch1');expect(client.focus).toHaveBeenCalled();
    scope.clients.matchAll.mockResolvedValue([]);
    await dispatch('notificationclick',{notification:{close:vi.fn(),data:{url:'https://evil.example/x'}}});
    expect(scope.clients.openWindow).toHaveBeenCalledWith('https://chat.example.com/');
  });
});

describe('mention delivery',()=>{
  let mf:Miniflare,db:D1Database,env:Env,connections=1;const realFetch=globalThis.fetch;let pushed:string[]=[];
  beforeAll(async()=>{
    mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-11-08',d1Databases:['DB']}));db=await mf.getD1Database('DB') as unknown as D1Database;
    for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec((await readFile(new URL('../migrations/'+file,import.meta.url),'utf8')).split('\n').filter(s=>!s.trim().startsWith('--')).join(' '));
    const vapid=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']) as CryptoKeyPair;
    const jwk=await crypto.subtle.exportKey('jwk',vapid.privateKey);
    env={DB:db,HUB_CONFIG:'{"appOrigin":"https://chat.example.com"}',VAPID_PUBLIC_KEY:b64(await crypto.subtle.exportKey('raw',vapid.publicKey)),VAPID_PRIVATE_KEY:jwk.d,VAPID_SUBJECT:'mailto:admin@example.test',
      LIVE:{idFromName:(s:string)=>s,get:()=>({fetch:async()=>Response.json({connections})})}} as unknown as Env;
    for(const id of ['owner','other','third']){
      await db.prepare('INSERT INTO users(id,email,name,role) VALUES(?,?,?,?)').bind(id,id+'@example.test',id,'member').run();await db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await sha256(id),id,Date.now()+3600000).run();
      const device=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']) as CryptoKeyPair;
      await db.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?,?)').bind('push-'+id,id,'https://push.example/'+id,b64(await crypto.subtle.exportKey('raw',device.publicKey)),b64(crypto.getRandomValues(new Uint8Array(16)))).run();
    }
    await db.exec("INSERT INTO spaces(id,name,all_members) VALUES('s','Space',1); INSERT INTO channels(id,space_id,name) VALUES('ch','s','General');");
  });
  afterAll(async()=>{await mf.dispose();});
  beforeEach(()=>{connections=1;pushed=[];globalThis.fetch=(async(input:RequestInfo|URL)=>{pushed.push(String(input));return new Response(null,{status:201});}) as typeof fetch;});
  afterEach(()=>{globalThis.fetch=realFetch;});
  const call=async(path:string,body:unknown,user='owner')=>{const pending:Promise<unknown>[]=[];const response=await app.request('https://chat.test/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:'thechat_session='+user},body:JSON.stringify(body)},env,{waitUntil:(p:Promise<unknown>)=>pending.push(p),passThroughOnException:()=>{},props:{}});await Promise.all(pending);return response;};

  it('pushes to a mentioned person even while a live connection exists',async()=>{
    const response=await call('channels/ch/messages',{body:'@other 確認お願いします',mentions:['other']});expect(response.status).toBe(201);
    expect(pushed).toEqual(['https://push.example/other']);
    const {id}=await response.json() as {id:string};
    expect(await pushContent(env,'other',id,'message')).toMatchObject({author:'owner',channelName:'General',mentioned:true,channelId:'ch',unread:1,body:'@other 確認お願いします'});
    expect(await pushContent(env,'third',id,'message')).toMatchObject({mentioned:false,unread:0});
  });
  it('keeps other notifications quiet while connected and pushes when offline',async()=>{
    expect((await call('channels/ch/messages',{body:'全員対応してください',intent:'ACTION'})).status).toBe(201);
    expect(pushed).toEqual([]);
    connections=0;
    expect((await call('channels/ch/messages',{body:'もう一度お願いします',intent:'ACTION'})).status).toBe(201);
    expect(pushed.sort()).toEqual(['https://push.example/other','https://push.example/third']);
  });
  it('removes only the caller\'s own subscription',async()=>{
    expect((await call('push/subscriptions/remove',{endpoint:'https://push.example/other'},'owner')).status).toBe(200);
    expect(await db.prepare("SELECT 1 FROM push_subscriptions WHERE id='push-other'").first()).not.toBeNull();
    expect((await call('push/subscriptions/remove',{endpoint:'https://push.example/third'},'third')).status).toBe(200);
    expect(await db.prepare("SELECT 1 FROM push_subscriptions WHERE id='push-third'").first()).toBeNull();
  });
});
