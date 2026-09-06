import { Home } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/layout/Logo';
import { routes } from '../components/layout/navigation';

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <Logo />
      <p className="mt-10 text-sm font-semibold uppercase tracking-wide text-brand-600">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        to={routes.dashboard}
        className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
      >
        <Home className="h-4 w-4" aria-hidden="true" />
        Back to dashboard
      </Link>
    </main>
  );
}
