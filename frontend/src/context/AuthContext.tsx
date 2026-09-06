import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { ApiError, setUnauthorizedHandler } from '../api';
import { authService } from '../services/auth.service';
import type { User } from '../types/user';

export const AUTH_QUERY_KEY = ['auth', 'me'] as const;

interface AuthContextValue {
  user: User | null;
  /** True while the initial session check is in flight. */
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Set when the session check failed for a reason other than "not signed in". */
  error: string | null;
  signInWithGoogle: () => void;
  signOut: () => void;
  isSigningOut: boolean;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => authService.currentUser(),
    // A 401 is a definitive "not signed in" — never retry it.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isAuthError) return false;
      return failureCount < 1;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // An expired session detected by any request drops the cached user at once.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.setQueryData(AUTH_QUERY_KEY, null);
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const logoutMutation = useMutation({
    mutationFn: () => authService.logout(),
    // Clear locally even if the request fails — the cookie may already be gone.
    onSettled: () => {
      queryClient.setQueryData(AUTH_QUERY_KEY, null);
      queryClient.clear();
    },
  });

  const signInWithGoogle = useCallback(() => {
    window.location.assign(authService.googleLoginUrl());
  }, []);

  const signOut = useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
  }, [queryClient]);

  const authError =
    session.error instanceof ApiError && !session.error.isAuthError
      ? session.error.message
      : null;

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session.data ?? null,
      isLoading: session.isPending,
      isAuthenticated: Boolean(session.data),
      error: authError,
      signInWithGoogle,
      signOut,
      isSigningOut: logoutMutation.isPending,
      refresh,
    }),
    [
      session.data,
      session.isPending,
      authError,
      signInWithGoogle,
      signOut,
      logoutMutation.isPending,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
