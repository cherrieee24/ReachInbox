import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Logo } from './Logo';
import { routes } from './navigation';
import { Spinner } from '../ui/Spinner';

/** Full-screen placeholder shown while the session cookie is being verified. */
function AuthCheckScreen() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-4"
    >
      <Logo />
      {/* The surrounding element is the live region. */}
      <Spinner size="lg" className="text-brand-600" decorative />
      <p className="text-sm text-slate-500">Checking your session…</p>
    </div>
  );
}

/**
 * Gate for every dashboard route. The real check is server-side — this only
 * decides what to render while `GET /auth/me` resolves, and where to send
 * people who are not signed in.
 */
export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <AuthCheckScreen />;

  if (!isAuthenticated) {
    return (
      <Navigate
        to={routes.login}
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <Outlet />;
}
