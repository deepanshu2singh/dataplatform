import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, setUnauthorizedHandler, setVerificationRequiredHandler } from '../lib/api';
import { isCanceledRequest, useLatestRequest } from '../hooks/useLatestRequest';

interface User {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
  is_superuser: boolean;
  email_verified: boolean;
  email_verification_required: boolean;
}

export type SecurityAction = 'password' | 'revoke';

interface AuthContextType {
  user: User | null;
  securityNotice: SecurityAction | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, full_name?: string) => Promise<void>;
  logout: () => Promise<void>;
  verifyEmail: (code: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  secureAccount: (action: SecurityAction, currentPassword: string, newPassword: string | undefined, beforeSignOut: () => void) => Promise<void>;
  updateProfile: (fullName: string | null, expectedFullName: string | null) => Promise<User>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [securityNotice, setSecurityNotice] = useState<SecurityAction | null>(null);
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
    setVerificationRequiredHandler(() => {
      setUser((current) => current ? { ...current, email_verified: false, email_verification_required: true } : null);
    });
    void fetchUser();

    return () => {
      setUnauthorizedHandler(null);
      setVerificationRequiredHandler(null);
    };
  }, [clearSession, fetchUser]);

  const login = async (email: string, password: string) => {
    setSecurityNotice(null);
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
    setSecurityNotice(null);
    sessionRequest.cancel();
    await api.post('/auth/logout');
    setUser(null);
    setLoading(false);
  };

  const verifyEmail = async (code: string) => {
    const request = sessionRequest.begin();
    try {
      const response = await api.post('/auth/email-verification/confirm', { code }, { signal: request.signal });
      if (request.isCurrent()) {
        setUser(response.data);
      }
    } finally {
      request.finish();
    }
  };

  const updateProfile = async (fullName: string | null, expectedFullName: string | null) => {
    const request = sessionRequest.begin();
    try {
      const response = await api.patch<User>('/auth/me', {
        full_name: fullName,
        expected_full_name: expectedFullName,
      }, { signal: request.signal });
      if (!request.isCurrent()) {
        throw Object.assign(new Error('The session changed before the profile response arrived'), { name: 'CanceledError', code: 'ERR_CANCELED' });
      }
      setUser(response.data);
      return response.data;
    } finally {
      request.finish();
    }
  };

  const secureAccount = async (action: SecurityAction, currentPassword: string, newPassword: string | undefined, beforeSignOut: () => void) => {
    const request = sessionRequest.begin();
    try {
      await api.post(action === 'password' ? '/auth/password' : '/auth/sessions/revoke',
        action === 'password' ? { current_password: currentPassword, new_password: newPassword } : { current_password: currentPassword },
        { signal: request.signal });
      if (!request.isCurrent()) {
        throw Object.assign(new Error('The session changed before the security response arrived'), { name: 'CanceledError', code: 'ERR_CANCELED' });
      }
      setSecurityNotice(action);
      beforeSignOut();
      clearSession();
    } finally {
      request.finish();
    }
  };

  return (
    <AuthContext.Provider value={{ user, securityNotice, loading, login, register, logout, verifyEmail, refreshUser: fetchUser, updateProfile, secureAccount }}>
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
