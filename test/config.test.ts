import { describe, expect, it } from 'vitest';
import { buildWrangler } from '../scripts/config.mjs';

describe('customer isolation', () => {
  it('keeps account details in generated, ignored configuration', () => {
    const result = buildWrangler({ organizationName:'Example', domain:'example.com', adminEmail:'admin@example.com', mailFrom:'chat@example.com', workerName:'example-chat', d1DatabaseId:'00000000-0000-0000-0000-000000000001', r2BucketName:'example-files' });
    expect(result.name).toBe('example-chat');
    expect(result.d1_databases[0].database_id).toBe('00000000-0000-0000-0000-000000000001');
    expect(result.vars.HUB_CONFIG).toContain('admin@example.com');
    expect(JSON.stringify(result)).not.toContain('apiKey');
    expect(result).not.toHaveProperty('triggers');
  });
  it('routes one literal subdomain address when email routing is enabled', () => {
    const result = buildWrangler({ organizationName:'Example', domain:'inbox.example.com', adminEmail:'admin@example.com', mailFrom:'chat@example.com', workerName:'example-chat', d1DatabaseId:'00000000-0000-0000-0000-000000000001', r2BucketName:'example-files', emailRouteAddress:'inbox@inbox.example.com', emailRoutingEnabled:true });
    expect(result).toHaveProperty('addresses',['inbox@inbox.example.com']);
  });
});
it('keeps an optional organization logo in generated config and rejects unsafe URLs',()=>{const base={organizationName:'Example',domain:'example.com',adminEmail:'admin@example.com',mailFrom:'chat@example.com',workerName:'example-chat',d1DatabaseId:'test-db',r2BucketName:'test-files'};expect(JSON.parse(buildWrangler({...base,logoUrl:'/arari-logo.svg'}).vars.HUB_CONFIG).logoUrl).toBe('/arari-logo.svg');expect(()=>buildWrangler({...base,logoUrl:'javascript:alert(1)'})).toThrow('logoUrl')});
it('keeps optional identity settings separate from public bootstrap and routes protocol to worker',()=>{
 const hub={organizationName:'Example',domain:'example.com',adminEmail:'admin@example.com',mailFrom:'chat@example.com',workerName:'example-chat',d1DatabaseId:'test-db',r2BucketName:'test-files',appOrigin:'https://chat.example.com',theid:{mode:'hybrid',issuer:'https://id.example.com/api/auth',clientId:'fixture',appId:'chat'}};
 const cfg=buildWrangler(hub) as any;
 expect(cfg.vars.THEID_MODE).toBe('hybrid');expect(cfg.vars.THEID_CLIENT_ID).toBe('fixture');
 expect(cfg.vars.HUB_CONFIG).not.toContain('clientId');expect(cfg.assets.run_worker_first).toContain('/_theid/*');
 expect(()=>buildWrangler({...hub,theid:{...hub.theid,clientSecret:'DO NOT STORE'}})).toThrow();
});
