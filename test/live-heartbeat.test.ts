import {it,expect,vi} from 'vitest';
import {connectLive} from '../src/client/live';
vi.mock('../src/client/api',()=>({api:async()=>({events:[]})}));
it('checks idle connections periodically and cleans up timers when leaving',async()=>{
 vi.useFakeTimers();
 let socket:any;
 class Socket {static OPEN=1;readyState=1;send=vi.fn();close=vi.fn();onopen?:()=>void;onmessage?:({data}:{data:string})=>void;constructor(){socket=this}}
 vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('location',{protocol:'https:',host:'chat.example.com'});
 vi.stubGlobal('sessionStorage',{getItem:()=>null,setItem:()=>{}});
 vi.stubGlobal('window',{setTimeout,clearTimeout,setInterval,clearInterval,addEventListener:()=>{},removeEventListener:()=>{}});
 vi.stubGlobal('document',{addEventListener:()=>{},removeEventListener:()=>{}});
 const stop=connectLive(()=>{});socket.onopen();await vi.advanceTimersByTimeAsync(30000);
 expect(socket.send).toHaveBeenCalledWith('ping');stop();const calls=socket.send.mock.calls.length;
 await vi.advanceTimersByTimeAsync(60000);expect(socket.send.mock.calls.length).toBe(calls);
 vi.useRealTimers();vi.unstubAllGlobals();
});
