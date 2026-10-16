import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { BrandedLoadingScreen } from './BrandedLoadingScreen';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <BrandedLoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.email_verification_required && !user.email_verified) return <Navigate to="/verify-email" replace />;
  return <>{children}</>;
}

export function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <BrandedLoadingScreen />;
  if (!user) return <>{children}</>;
  return <Navigate to={user.email_verification_required && !user.email_verified ? '/verify-email' : '/'} replace />;
}

export function VerificationRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <BrandedLoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.email_verified) return <Navigate to="/" replace />;
  return <>{children}</>;
}
