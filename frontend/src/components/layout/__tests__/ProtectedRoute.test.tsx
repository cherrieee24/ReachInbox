import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../ProtectedRoute';
import { renderWithProviders } from '../../../test/utils';

const useAuth = vi.hoisted(() => vi.fn());
vi.mock('../../../context/AuthContext', () => ({ useAuth }));

function TreeUnderTest() {
  return (
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<p>Protected content</p>} />
      </Route>
      <Route path="/login" element={<p>Sign in to ReachInbox</p>} />
    </Routes>
  );
}

const state = (over: Partial<ReturnType<typeof useAuth>> = {}) => ({
  user: null,
  isLoading: false,
  isAuthenticated: false,
  error: null,
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
  isSigningOut: false,
  refresh: vi.fn(),
  ...over,
});

describe('ProtectedRoute', () => {
  it('shows a session check instead of flashing the login page', () => {
    useAuth.mockReturnValue(state({ isLoading: true }));
    renderWithProviders(<TreeUnderTest />, { route: '/dashboard' });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/checking your session/i)).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in to reachinbox/i)).not.toBeInTheDocument();
  });

  it('redirects to login when there is no session', () => {
    useAuth.mockReturnValue(state({ isLoading: false, isAuthenticated: false }));
    renderWithProviders(<TreeUnderTest />, { route: '/dashboard' });

    expect(screen.getByText(/sign in to reachinbox/i)).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders the route once authenticated', () => {
    useAuth.mockReturnValue(
      state({ isAuthenticated: true, user: { id: 'u1', name: 'A', email: 'a@b.c', avatar: null, role: 'MEMBER', createdAt: '', updatedAt: '' } }),
    );
    renderWithProviders(<TreeUnderTest />, { route: '/dashboard' });

    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });
});
