export function shouldSend(event:{key:string;ctrlKey:boolean;metaKey:boolean}, _suggestionsOpen:boolean):boolean {
  return event.key==='Enter' && (event.ctrlKey||event.metaKey);
}
export function nextThreadState(rootId:string|null) { return {rootId,messages:[] as unknown[],cursor:null as string|null}; }
