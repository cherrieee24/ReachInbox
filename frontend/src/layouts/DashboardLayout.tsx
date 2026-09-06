import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ComposeEmailModal } from '../components/email/ComposeEmailModal';
import { Header } from '../components/layout/Header';
import { Sidebar } from '../components/layout/Sidebar';
import { pageTitles, routes } from '../components/layout/navigation';
import { Button } from '../components/ui/Button';
import { ComposeProvider, useCompose } from '../context/ComposeContext';

function Shell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { pathname } = useLocation();
  const compose = useCompose();

  const page = pageTitles[pathname] ?? { title: 'ReachInbox' };

  return (
    <div className="flex min-h-screen bg-surface-muted">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          title={page.title}
          breadcrumb={page.breadcrumb}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          actions={
            // The dashboard renders its own prominent CTA — don't duplicate it.
            pathname === routes.dashboard || pathname === routes.compose ? undefined : (
              <Button
                size="sm"
                onClick={compose.open}
                leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              >
                Compose New Email
              </Button>
            )
          }
        />

        <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>

      <ComposeEmailModal open={compose.isOpen} onClose={compose.close} />
    </div>
  );
}

export function DashboardLayout() {
  return (
    <ComposeProvider>
      <Shell />
    </ComposeProvider>
  );
}
