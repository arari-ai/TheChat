export function shouldSend(event:{key:string;ctrlKey:boolean;metaKey:boolean}, _suggestionsOpen:boolean):boolean {
  return event.key==='Enter' && (event.ctrlKey||event.metaKey);
}
export function nextThreadState<T>(currentRootId:string|null,rootId:string,messages:T[],cursor:string|null) {
  return currentRootId===rootId?{rootId,messages,cursor}:{rootId,messages:[] as T[],cursor:null};
}

export function linkedChannel(search:string,channels:{id:string}[]){const id=new URLSearchParams(search).get('channel');return id?channels.find(c=>c.id===id)?.id||null:null;}
