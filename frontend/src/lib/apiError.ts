import axios from 'axios';

export interface ApiErrorInfo {
  message: string;
  status?: number;
  requestId?: string;
  kind: 'http' | 'network' | 'timeout' | 'unknown';
  retryable: boolean;
}

const NETWORK_MESSAGE = 'Unable to reach the server. Please check your connection and try again.';
const TIMEOUT_MESSAGE = 'The request timed out. Please try again.';

function validationMessage(detail: unknown): string | null {
  if (!Array.isArray(detail)) {
    return null;
  }

  const messages = detail
    .map((item) => {
      if (item && typeof item === 'object' && 'msg' in item) {
        const message = (item as { msg?: unknown }).msg;
        return typeof message === 'string' ? message : '';
      }
      return '';
    })
    .filter(Boolean);

  return messages.length ? messages.join(' ') : null;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }

  const maybeAxiosHeaders = headers as { get?: (key: string) => unknown };
  if (typeof maybeAxiosHeaders.get === 'function') {
    const value = maybeAxiosHeaders.get(name);
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function responseRequestId(data: unknown, headers: unknown): string | undefined {
  if (data && typeof data === 'object' && 'request_id' in data) {
    const value = (data as { request_id?: unknown }).request_id;
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return headerValue(headers, 'x-request-id');
}

export function getApiErrorInfo(error: unknown, fallback: string): ApiErrorInfo {
  const errorLike =
    error && typeof error === 'object'
      ? (error as {
          code?: string;
          message?: string;
          response?: { status?: number; data?: unknown; headers?: unknown };
        })
      : null;

  const looksLikeApiError =
    axios.isAxiosError(error) ||
    Boolean(errorLike && ('response' in errorLike || 'code' in errorLike));

  if (!errorLike || !looksLikeApiError) {
    return {
      message: fallback,
      kind: 'unknown',
      retryable: false,
    };
  }

  const timeout =
    errorLike.code === 'ECONNABORTED' ||
    errorLike.code === 'ETIMEDOUT' ||
    /timeout/i.test(errorLike.message ?? '');

  if (!errorLike.response) {
    return {
      message: timeout ? TIMEOUT_MESSAGE : NETWORK_MESSAGE,
      kind: timeout ? 'timeout' : 'network',
      retryable: true,
    };
  }

  const status = errorLike.response.status;
  const data = errorLike.response.data;
  const detail =
    data && typeof data === 'object' && 'detail' in data
      ? (data as { detail?: unknown }).detail
      : undefined;

  let message = fallback;
  if (typeof status !== 'number' || status < 500) {
    if (typeof detail === 'string' && detail.trim()) {
      message = detail.trim();
    } else {
      message = validationMessage(detail) ?? fallback;
    }
  }

  return {
    message,
    status,
    requestId: responseRequestId(data, errorLike.response.headers),
    kind: 'http',
    retryable:
      typeof status === 'number' &&
      (status >= 500 || status === 408 || status === 429),
  };
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const info = getApiErrorInfo(error, fallback);

  if (info.requestId && typeof info.status === 'number' && info.status >= 500) {
    return `${info.message} Reference: ${info.requestId}`;
  }

  return info.message;
}
