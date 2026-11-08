export interface HubConfig {
  organizationName: string;
  domain: string;
  adminEmail: string;
  mailFrom: string;
  fileTransferUrl?: string;
  calendarUrl?: string;
  emailProvider?: 'cloudflare' | 'resend';
  emailRouteAddress?: string;
}
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  LIVE: DurableObjectNamespace;
  HUB_CONFIG: string;
  RESEND_API_KEY?: string;
  EMAIL?: { send(message: { to: string; from: string; subject: string; text: string; headers?: Record<string,string> }): Promise<{ messageId: string }> };
  EVENTS_QUEUE?: Queue;
  ASSETS?: Fetcher;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}
export function config(env: Env): HubConfig {
  return JSON.parse(env.HUB_CONFIG || '{}') as HubConfig;
}
