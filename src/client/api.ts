export async function api<T>(path:string,options:RequestInit={}):Promise<T> {
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers},credentials:'same-origin'});
  if(!response.ok){const body=await response.json().catch(()=>({error:`HTTP ${response.status}`})) as {error?:string};throw new Error(body.error||`HTTP ${response.status}`);}
  return response.json() as Promise<T>;
}
export const post=<T>(path:string,body:unknown)=>api<T>(path,{method:'POST',body:JSON.stringify(body)});
export type User={id:string;email:string;name:string;role:'admin'|'member'|'guest';affiliation:string|null};
export type Space={id:string;name:string;all_members:number};
export type Channel={id:string;space_id:string;name:string;mail_address:string|null};
export type Message={id:string;channel_id:string;thread_root_id:string|null;author_id:string|null;author_name:string|null;external_name:string|null;external_email:string|null;author_affiliation:string|null;body:string;intent:string|null;due_date:string|null;source:string;status:string;addressees:string;addressee_status:string;created_at:string;attachment_list?:string};
export type InboxItem=Message&{space_name:string;channel_name:string;addressee_status:string};
