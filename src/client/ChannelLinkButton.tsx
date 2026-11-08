import{useEffect,useRef,useState}from'react';
import{copyChannelLink}from'./channel-link';
export function ChannelLinkButton({channelId}:{channelId:string}){
 const[copied,setCopied]=useState(false),[fallback,setFallback]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const url=new URL('/',location.origin);url.searchParams.set('channel',channelId);
 useEffect(()=>{if(fallback)dialog.current?.showModal();else dialog.current?.close()},[fallback]);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
 async function copy(){const ok=await copyChannelLink(url.toString(),navigator.clipboard);setCopied(ok);if(ok){if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(false),3000)}else setFallback(true)}
 return <><button className="menu-button channel-link-button" title="チャンネルURLをコピー" onClick={copy}>{copied?'コピーしました':'リンクをコピー'}</button><span role="status" className="link-copy-status">{copied?'チャンネルのリンクをコピーしました':''}</span><dialog ref={dialog} className="channel-link-dialog" onCancel={()=>setFallback(false)}><h2>チャンネルのリンク</h2><p>自動でコピーできませんでした。URLを選択してコピーしてください。</p><label>チャンネルURL<input readOnly value={url.toString()} onFocus={e=>e.currentTarget.select()}/></label><button onClick={()=>setFallback(false)}>閉じる</button></dialog></>;
}
