import React,{useState} from 'react';
import {api,type Message} from './api';
export function MessageEditor({message,onSaved,onCancel}:{message:Message;onSaved:()=>void;onCancel:()=>void}){
 const [base]=useState(message.body);const [text,setText]=useState(message.body),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(){if(busy||!text.trim())return;setBusy(true);setError('');try{await api('/api/messages/'+message.id,{method:'PATCH',body:JSON.stringify({body:text,expectedBody:base})});onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="message-editor"><textarea autoFocus aria-label="投稿を編集" value={text} maxLength={10000} disabled={busy} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Escape'&&!busy)onCancel();if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void save();}}}/><div><button disabled={busy||!text.trim()} onClick={()=>void save()}>変更を保存</button><button disabled={busy} onClick={onCancel}>キャンセル</button></div>{error&&<p role="alert" className="error">{error}</p>}</div>;
}
export function DeleteMessage({message,onDeleted}:{message:Message;onDeleted:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function remove(){if(busy||!window.confirm('この投稿を削除しますか？返信は残ります。'))return;setBusy(true);setError('');try{await api('/api/messages/'+message.id,{method:'DELETE'});onDeleted();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <><button aria-label="投稿を削除" disabled={busy} onClick={()=>void remove()}>削除</button>{error&&<span role="alert" className="error">{error}</span>}</>;
}
