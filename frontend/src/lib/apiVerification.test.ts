import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, setUnauthorizedHandler, setVerificationRequiredHandler } from './api';

const adapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = adapter; setUnauthorizedHandler(null); setVerificationRequiredHandler(null); });

describe('verification API access errors', () => {
  it('routes the explicit server verification requirement without treating other 403s as verification errors', async () => {
    const verify = vi.fn(); setVerificationRequiredHandler(verify);
    for (const required of [false, true]) {
      api.defaults.adapter = async (config) => {
        throw new axios.AxiosError('Forbidden', 'ERR_BAD_REQUEST', config, undefined, {
          status: 403, statusText: 'Forbidden', config, data: { detail: 'Forbidden' },
          headers: required ? { 'x-email-verification-required': 'true' } : {},
        });
      };
      await expect(api.get('/datasets')).rejects.toBeDefined();
      expect(verify).toHaveBeenCalledTimes(required ? 1 : 0);
    }
  });
});
