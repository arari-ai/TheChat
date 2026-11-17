self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Accepts both the Declarative Web Push shape and the plain one. A notification is always shown: Safari revokes silent subscriptions.
self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?.json()||{};}catch{/* show the generic text */}
  const item=data.web_push===8030&&data.notification?data.notification:data;
  const jobs=[self.registration.showNotification(item.title||'TheChat',{body:item.body||'新しい連絡があります',data:{url:item.navigate||item.url||'/'}})];
  const raw=item.app_badge??item.badge;
  const badge=raw===undefined||raw===null?NaN:Number(raw);
  if(Number.isFinite(badge)&&self.navigator?.setAppBadge)jobs.push((badge>0?self.navigator.setAppBadge(badge):self.navigator.clearAppBadge()).catch(()=>{}));
  event.waitUntil(Promise.all(jobs));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  let target=self.location.origin+'/';
  try{const url=new URL(event.notification.data?.url||'/',self.location.origin);if(url.origin===self.location.origin)target=url.href;}catch{/* open the top page */}
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      try{await client.navigate(target);await client.focus();return;}catch{/* try the next window */}
    }
    await self.clients.openWindow(target);
  })());
});
