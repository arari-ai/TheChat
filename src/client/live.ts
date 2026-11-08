import { retryDelay } from '../shared/live';
import { api } from './api';

type EventItem={id:number;kind:string;messageId:string;channelId:string|null;dmId:string|null};
export function connectLive(onEvent:()=>void):()=>void {
  let stopped=false,attempt=0,socket:WebSocket|null=null,timer=0;
  let cursor=Number(sessionStorage.getItem('thechat-event-cursor')||0);
  async function catchUp(){
    try{
      for(;;){
        const data=await api<{events:EventItem[]}>(`/api/events?after=${cursor}`);
        if(!data.events.length)break;
        const next=data.events.at(-1)!.id;
        if(next<=cursor)break;
        cursor=next;sessionStorage.setItem('thechat-event-cursor',String(cursor));onEvent();
        if(data.events.length<200)break;
      }
    }catch{/* next connection retries */}
  }
  function open(){
    if(stopped)return;
    catchUp();
    const current=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/live`);
    socket=current;
    current.onopen=()=>{attempt=0;catchUp();};
    current.onmessage=()=>{catchUp();};
    current.onclose=()=>{if(!stopped&&socket===current)timer=window.setTimeout(open,retryDelay(attempt++));};
    current.onerror=()=>current.close();
  }
  open();
  const online=()=>{if(socket?.readyState!==WebSocket.OPEN){window.clearTimeout(timer);const old=socket;socket=null;old?.close();open();}else catchUp();};
  window.addEventListener('online',online);document.addEventListener('visibilitychange',online);
  return ()=>{stopped=true;window.clearTimeout(timer);socket?.close();window.removeEventListener('online',online);document.removeEventListener('visibilitychange',online);};
}
