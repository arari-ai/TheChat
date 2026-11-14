export interface HubConfig {
  appOrigin?: string;
  organizationName: string;
  logoUrl?: string;
  logoOnDarkUrl?: string;
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
  THEID_MODE?: 'local'|'hybrid'|'oidc';
  THEID_ISSUER?: string;
  THEID_CLIENT_ID?: string;
  THEID_APP_ID?: string;
  THEID_CLIENT_SECRET?: string;
  THEID_AUTH_POLICY?: 'standard'|'mfa';
  LOCAL_AUTH?: string;
  RESEND_API_KEY?: string;
  HRM_TOKEN?: string;
  CRM_URL?: string;
  CRM_TOKEN?: string;
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
