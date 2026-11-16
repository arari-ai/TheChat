import {useEffect,useRef,useState} from 'react';
import {api,type Message} from './api';
type Page={messages:Message[];cursor:string|null;hasMore:boolean;replyCount?:number};
const empty:Page={messages:[],cursor:null,hasMore:false};
const before=(url:string,cursor:string)=>url+(url.includes('?')?'&':'?')+'before='+encodeURIComponent(cursor);
export async function refreshMessages(url:string,oldest:string|null,load:(url:string)=>Promise<Page>=api):Promise<Page>{
 const first=await load(url);let result=first;
 while(oldest&&result.hasMore&&result.cursor&&result.cursor>oldest){
  const page=await load(before(url,result.cursor));
  if(!page.messages.length||!page.cursor||page.cursor>=result.cursor)break;
  result={...page,messages:[...page.messages,...result.messages],replyCount:first.replyCount};
 }
 return result;
}
export function useConversation(url:string|null,refreshSeq:number){
 const [state,setState]=useState<Page&{url:string|null}>({...empty,url:null}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const current=useRef(state),selected=useRef(url),epoch=useRef(0);current.current=state;selected.current=url;
 useEffect(()=>{
  const version=++epoch.current;if(!url){setBusy(false);return;}
  const oldest=current.current.url===url?current.current.messages[0]?.id??null:null;
  setBusy(true);setError('');
  refreshMessages(url,oldest).then(page=>{if(epoch.current===version)setState({...page,url});}).catch(e=>{if(epoch.current===version)setError(e.message);}).finally(()=>{if(epoch.current===version)setBusy(false);});
  return()=>{if(epoch.current===version)epoch.current++;};
 },[url,refreshSeq]);
 async function more(){
  if(!url||busy||current.current.url!==url||!current.current.hasMore||!current.current.cursor)return;
  const snapshot=current.current,version=++epoch.current;setBusy(true);setError('');
  try{const page=await api<Page>(before(url,snapshot.cursor!));if(epoch.current===version&&selected.current===url)setState({...page,replyCount:snapshot.replyCount,messages:[...page.messages,...snapshot.messages],url});}
  catch(e){if(epoch.current===version)setError((e as Error).message);}finally{if(epoch.current===version)setBusy(false);}
 }
 return {...(state.url===url?state:empty),error,busy,more};
}
