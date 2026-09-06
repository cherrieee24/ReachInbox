import type { ReactNode } from 'react';
import { Logo } from '../components/layout/Logo';

export interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen">
      <main className="flex w-full flex-col justify-center px-4 py-12 sm:px-8 lg:w-[52%] lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Logo />
          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-8">{footer}</div> : null}
        </div>
      </main>

      {/* Marketing rail — hidden on small screens where it would only add noise. */}
      <aside className="hidden bg-slate-900 lg:flex lg:w-[48%] lg:flex-col lg:justify-center lg:px-16">
        <blockquote className="max-w-md">
          <p className="text-xl font-medium leading-relaxed text-white">
            “We moved 40,000 monthly sends onto ReachInbox and cut our bounce rate by half in the
            first three weeks.”
          </p>
          <footer className="mt-6 text-sm text-slate-400">
            <span className="block font-medium text-slate-200">Priya Sharma</span>
            Head of Growth, Northwind
          </footer>
        </blockquote>

        <dl className="mt-12 grid max-w-md grid-cols-3 gap-6 border-t border-white/10 pt-8">
          {[
            ['99.2%', 'Delivery rate'],
            ['4.1M', 'Emails scheduled'],
            ['< 2s', 'Queue latency'],
          ].map(([value, label]) => (
            <div key={label}>
              <dt className="sr-only">{label}</dt>
              <dd>
                <span className="block text-lg font-semibold text-white">{value}</span>
                <span className="mt-0.5 block text-xs text-slate-400">{label}</span>
              </dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}
