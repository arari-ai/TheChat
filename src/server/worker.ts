import { app } from './api';
import { getViewer } from './auth';
import { receiveMail, type IncomingEmail } from './mail';
import { UserLive } from './live';
import type { Env } from './env';
import { sendDigests } from './notifications';

export { UserLive };
export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname==='/api/live') {
      const user=await getViewer(request,env);
      if(!user)return new Response('Unauthorized',{status:401});
      if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('Upgrade required',{status:426});
      return env.LIVE.get(env.LIVE.idFromName(user.id)).fetch(request);
    }
    if(url.pathname.startsWith('/api/')) return app.fetch(request,env,ctx);
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found',{status:404});
  },
  async email(message:IncomingEmail,env:Env):Promise<void> { await receiveMail(message,env); },
  async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext):Promise<void> { ctx.waitUntil(sendDigests(env)); },
} satisfies ExportedHandler<Env>;
