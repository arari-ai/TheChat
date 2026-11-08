import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { sendDigests } from './notifications';

export class UserLive extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if(new URL(request.url).pathname==='/digest/ensure'&&request.method==='POST') {
      if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+300000);
      return Response.json({scheduled:true});
    }
    if (request.method === 'POST') {
      const payload = await request.text();
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send(payload); } catch { /* an expired socket is removed by the runtime */ }
      }
      return Response.json({connections:this.ctx.getWebSockets().length});
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required',{status:426});
    const pair = new WebSocketPair(); const [client,server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(socket: WebSocket, message: string|ArrayBuffer): void {
    if (message === 'ping') socket.send('pong');
  }
  webSocketClose(): void { /* the runtime already closed the socket */ }
  async alarm(): Promise<void> {
    await sendDigests(this.env);
    const pending=await this.env.DB.prepare('SELECT 1 FROM events e LEFT JOIN channels ch ON ch.id=e.channel_id LEFT JOIN spaces s ON s.id=ch.space_id WHERE e.notifiable=1 AND e.read_at IS NULL AND e.emailed_at IS NULL AND (e.channel_id IS NULL OR (ch.archived=0 AND s.archived=0)) LIMIT 1').first();
    if(pending)await this.ctx.storage.setAlarm(Date.now()+300000);
  }
}
