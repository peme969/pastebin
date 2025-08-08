import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('authorization', () => {
  it('rejects Bearer null', async () => {
    const request = new Request('http://example.com/api/pastes', {
      headers: { Authorization: 'Bearer null' },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });

  it('rejects Bearer undefined', async () => {
    const request = new Request('http://example.com/api/pastes', {
      headers: { Authorization: 'Bearer undefined' },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });
});

