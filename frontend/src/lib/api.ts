import axios from 'axios';

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export const DEFAULT_API_TIMEOUT_MS = 30_000;
export const UPLOAD_API_TIMEOUT_MS = 300_000;

export const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_URL ||
    'http://localhost:8000/api/v1',
  withCredentials: true,
  timeout: DEFAULT_API_TIMEOUT_MS,
});

export function setUnauthorizedHandler(
  handler: UnauthorizedHandler | null,
) {
  unauthorizedHandler = handler;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = String(error.config?.url ?? '');
    const isLoginRequest = requestUrl.endsWith('/auth/login');

    if (error.response?.status === 401 && !isLoginRequest) {
      unauthorizedHandler?.();
    }

    return Promise.reject(error);
  },
);
