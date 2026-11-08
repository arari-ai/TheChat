import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

export class UserLive extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
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
  webSocketClose(socket: WebSocket, code: number, reason: string): void { socket.close(code,reason); }
}
