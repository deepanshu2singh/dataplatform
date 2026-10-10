import { describe, expect, it } from 'vitest';

import { api, DEFAULT_API_TIMEOUT_MS, UPLOAD_API_TIMEOUT_MS } from './api';

describe('api client defaults', () => {
  it('uses credentials and a bounded default request timeout', () => {
    expect(api.defaults.withCredentials).toBe(true);
    expect(api.defaults.timeout).toBe(DEFAULT_API_TIMEOUT_MS);
    expect(DEFAULT_API_TIMEOUT_MS).toBe(30_000);
  });

  it('keeps a separate bounded timeout for large CSV uploads', () => {
    expect(UPLOAD_API_TIMEOUT_MS).toBe(300_000);
    expect(UPLOAD_API_TIMEOUT_MS).toBeGreaterThan(DEFAULT_API_TIMEOUT_MS);
  });
});
