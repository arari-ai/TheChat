import { api, post } from './api';

type BadgeTarget={setAppBadge?:(count:number)=>Promise<void>;clearAppBadge?:()=>Promise<void>};
export function applyBadge(target:BadgeTarget,count:number):void {
  try{
    if(count>0)target.setAppBadge?.(count)?.catch(()=>{});
    else target.clearAppBadge?.()?.catch(()=>{});
  }catch{/* the badge is optional */}
}
export function vapidBytes(key:string):Uint8Array<ArrayBuffer> {
  const padded=key.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(padded+'='.repeat((4-padded.length%4)%4)),c=>c.charCodeAt(0));
}
export const pushSupported=():boolean=>'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;

// iOS can drop a subscription without notice, so every launch re-registers the current one.
export async function syncPushSubscription():Promise<boolean> {
  if(!pushSupported()||Notification.permission!=='granted')return false;
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription){
    const {publicKey}=await api<{publicKey:string|null}>('/api/push/key');
    if(!publicKey)throw new Error('通知キーがまだ設定されていません');
    subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(publicKey)});
  }
  await post('/api/push/subscriptions',subscription.toJSON());
  return true;
}
// A signed-out device must stop receiving message text.
export async function removePushSubscription():Promise<void> {
  if(!pushSupported())return;
  const registration=await navigator.serviceWorker.getRegistration();
  const subscription=await registration?.pushManager.getSubscription();
  if(!subscription)return;
  await post('/api/push/subscriptions/remove',{endpoint:subscription.endpoint}).catch(()=>{});
  await subscription.unsubscribe().catch(()=>{});
}
