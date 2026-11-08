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
});
