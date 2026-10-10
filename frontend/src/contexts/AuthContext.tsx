import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, setUnauthorizedHandler } from '../lib/api';
import { isCanceledRequest, useLatestRequest } from '../hooks/useLatestRequest';

interface User {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
  is_superuser: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, full_name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionRequest = useLatestRequest();

  const clearSession = useCallback(() => {
    sessionRequest.cancel();
    setUser(null);
    setLoading(false);
  }, [sessionRequest]);

  const fetchUser = useCallback(async () => {
    const request = sessionRequest.begin();

    try {
      const response = await api.get('/auth/me', { signal: request.signal });
      if (request.isCurrent()) {
        setUser(response.data);
      }
    } catch (error: unknown) {
      if (request.isCurrent() && !isCanceledRequest(error)) {
        setUser(null);
      }
    } finally {
      if (request.isCurrent()) {
        setLoading(false);
      }
      request.finish();
    }
  }, [sessionRequest]);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    void fetchUser();

    return () => {
      setUnauthorizedHandler(null);
    };
  }, [clearSession, fetchUser]);

  const login = async (email: string, password: string) => {
    const formData = new URLSearchParams();

    formData.append('username', email.trim().toLowerCase());
    formData.append('password', password);

    await api.post(
      '/auth/login',
      formData,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    await fetchUser();
  };

  const register = async (
    email: string,
    password: string,
    full_name?: string,
  ) => {
    const normalizedEmail = email.trim().toLowerCase();

    await api.post('/auth/register', {
      email: normalizedEmail,
      password,
      full_name: full_name?.trim() || null,
    });

    await login(normalizedEmail, password);
  };

  const logout = async () => {
    sessionRequest.cancel();
    await api.post('/auth/logout');
    setUser(null);
    setLoading(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
