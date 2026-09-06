import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from '../LoginPage';
import { renderWithProviders } from '../../test/utils';

const useAuth = vi.hoisted(() => vi.fn());
vi.mock('../../context/AuthContext', () => ({ useAuth }));

const signInWithGoogle = vi.fn();
const state = (over = {}) => ({
  user: null, isLoading: false, isAuthenticated: false, error: null,
  signInWithGoogle, signOut: vi.fn(), isSigningOut: false, refresh: vi.fn(), ...over,
});

describe('LoginPage', () => {
  it('offers Google sign-in and no password field', () => {
    useAuth.mockReturnValue(state());
    renderWithProviders(<LoginPage />, { route: '/login' });

    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    // Authentication is delegated entirely to Google; a password box here
    // would mean a mock login path had crept back in.
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('starts the OAuth flow on click', async () => {
    useAuth.mockReturnValue(state());
    renderWithProviders(<LoginPage />, { route: '/login' });

    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(signInWithGoogle).toHaveBeenCalledOnce();
  });

  it('explains a failed OAuth attempt', () => {
    useAuth.mockReturnValue(state());
    renderWithProviders(<LoginPage />, { route: '/login?error=access_denied' });

    expect(screen.getByRole('alert')).toHaveTextContent(/cancelled the google sign-in/i);
  });

  it('names the specific failure for an unverifiable state', () => {
    useAuth.mockReturnValue(state());
    renderWithProviders(<LoginPage />, { route: '/login?error=invalid_state' });

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be verified/i);
  });
});
