import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { routes } from '../components/layout/navigation';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import { AuthLayout } from '../layouts/AuthLayout';
import type { AuthErrorCode } from '../types/user';

/** Messages for the `?error=` codes the backend redirects back with. */
const OAUTH_ERRORS: Record<AuthErrorCode, string> = {
  access_denied: 'You cancelled the Google sign-in. Try again when you are ready.',
  invalid_state:
    'That sign-in link could not be verified. Start again from this page to get a fresh one.',
  missing_code: 'Google did not send back an authorisation code. Please try again.',
  oauth_failed: 'We could not complete sign-in with Google. Please try again.',
  oauth_unavailable:
    'Google sign-in is not configured on this server yet. Contact your administrator.',
};

function messageFor(code: string | null): string | null {
  if (!code) return null;
  return OAUTH_ERRORS[code as AuthErrorCode] ?? 'Sign-in failed. Please try again.';
}

export default function LoginPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, signInWithGoogle } = useAuth();

  // Captured once on mount: the code is then stripped from the URL, so the
  // banner must not be derived from the live search params.
  const [oauthError] = useState(() => messageFor(params.get('error')));

  useEffect(() => {
    if (!params.has('error')) return;
    const next = new URLSearchParams(params);
    next.delete('error');
    setParams(next, { replace: true });
  }, [params, setParams]);

  // Someone already signed in has no business on the login screen.
  useEffect(() => {
    if (isAuthenticated) navigate(routes.dashboard, { replace: true });
  }, [isAuthenticated, navigate]);

  if (isAuthenticated) return <Navigate to={routes.dashboard} replace />;

  return (
    <AuthLayout
      title="Sign in to ReachInbox"
      subtitle="Schedule, throttle and track your outbound email from one place."
      footer={
        <p className="text-center text-xs text-slate-500">
          By continuing you agree to the ReachInbox terms of service and privacy policy.
        </p>
      }
    >
      {oauthError ? (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{oauthError}</span>
        </div>
      ) : null}

      <Button
        fullWidth
        size="lg"
        variant="outline"
        onClick={signInWithGoogle}
        isLoading={isLoading}
        leftIcon={
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9Z" />
            <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z" />
            <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1Z" />
            <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
          </svg>
        }
      >
        Continue with Google
      </Button>

      <p className="mt-4 text-center text-sm text-slate-500">
        ReachInbox uses your Google account to sign you in. We never see or store your password.
      </p>
    </AuthLayout>
  );
}
