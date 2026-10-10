import { describe, expect, it } from 'vitest';
import { getApiErrorInfo, getApiErrorMessage } from './apiError';

describe('apiError', () => {
  it('uses a safe backend detail for known HTTP errors', () => {
    const error = {
      response: {
        status: 409,
        data: { detail: 'The resource changed. Refresh and try again.' },
        headers: { 'x-request-id': 'req-conflict-1' },
      },
    };

    expect(getApiErrorInfo(error, 'Fallback')).toEqual({
      message: 'The resource changed. Refresh and try again.',
      status: 409,
      requestId: 'req-conflict-1',
      kind: 'http',
      retryable: false,
    });
    expect(getApiErrorMessage(error, 'Fallback')).toBe(
      'The resource changed. Refresh and try again.',
    );
  });

  it('joins FastAPI validation messages from a 422 response', () => {
    const error = {
      response: {
        status: 422,
        data: {
          detail: [
            { msg: 'Name is required.' },
            { msg: 'Description is too long.' },
          ],
        },
      },
    };

    expect(getApiErrorMessage(error, 'Invalid request.')).toBe(
      'Name is required. Description is too long.',
    );
  });

  it('classifies a network failure as retryable', () => {
    const error = { code: 'ERR_NETWORK', message: 'Network Error' };
    const info = getApiErrorInfo(error, 'Fallback');

    expect(info.kind).toBe('network');
    expect(info.retryable).toBe(true);
    expect(info.message).toMatch(/Unable to reach the server/i);
  });

  it('classifies a timeout separately from a generic network failure', () => {
    const error = { code: 'ECONNABORTED', message: 'timeout of 1000ms exceeded' };
    const info = getApiErrorInfo(error, 'Fallback');

    expect(info.kind).toBe('timeout');
    expect(info.retryable).toBe(true);
    expect(info.message).toBe('The request timed out. Please try again.');
  });

  it('surfaces the request id on unexpected server errors', () => {
    const error = {
      response: {
        status: 500,
        data: {
          detail: 'An unexpected server error occurred.',
          request_id: 'req-server-500',
        },
        headers: {},
      },
    };

    expect(getApiErrorMessage(error, 'Request failed.')).toBe(
      'Request failed. Reference: req-server-500',
    );
  });

  it('falls back to the X-Request-ID response header when the body has no id', () => {
    const error = {
      response: {
        status: 503,
        data: { detail: 'Service temporarily unavailable.' },
        headers: { 'x-request-id': 'req-header-503' },
      },
    };

    expect(getApiErrorMessage(error, 'Request failed.')).toBe(
      'Request failed. Reference: req-header-503',
    );
  });

  it('uses the caller fallback for non-API exceptions', () => {
    expect(getApiErrorMessage(new Error('internal detail'), 'Safe fallback.')).toBe(
      'Safe fallback.',
    );
  });
});
