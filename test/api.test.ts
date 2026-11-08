import { describe, expect, it } from 'vitest';
import { app } from '../src/server/api';

describe('API boundary', () => {
  it('has a public health endpoint without exposing configuration', async () => {
    const response = await app.request('/api/health', {}, { HUB_CONFIG: '{"organizationName":"Secret Org"}' } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: '1.0.0' });
  });
  it('rejects anonymous space enumeration', async () => {
    const response = await app.request('/api/spaces', {}, {} as never);
    expect(response.status).toBe(401);
  });
});
