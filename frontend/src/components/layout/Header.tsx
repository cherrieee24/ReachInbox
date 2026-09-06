import { Menu } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { NotificationMenu } from './NotificationMenu';
import { UserMenu } from './UserMenu';

export interface HeaderProps {
  title: string;
  breadcrumb?: string[];
  actions?: ReactNode;
  onOpenMobileNav: () => void;
}

export function Header({ title, breadcrumb, actions, onOpenMobileNav }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
          className="-ml-1 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 lg:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          {breadcrumb && breadcrumb.length > 0 ? (
            <nav aria-label="Breadcrumb">
              <ol className="flex items-center gap-1.5 text-xs text-slate-500">
                {breadcrumb.map((crumb, index) => (
                  <Fragment key={crumb}>
                    {index > 0 ? (
                      <li aria-hidden="true" className="text-slate-300">
                        /
                      </li>
                    ) : null}
                    <li className="truncate">{crumb}</li>
                  </Fragment>
                ))}
              </ol>
            </nav>
          ) : null}
          <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900">{title}</h1>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3">
          {actions ? <div className="hidden sm:flex sm:items-center sm:gap-2">{actions}</div> : null}
          <NotificationMenu />
          <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />
          <UserMenu />
        </div>
      </div>
      {actions ? <div className="flex gap-2 px-4 pb-3 sm:hidden">{actions}</div> : null}
    </header>
  );
}
