import { ChevronDown, LifeBuoy, LogOut, Settings, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { Dropdown, DropdownItem, DropdownSeparator } from '../ui/Dropdown';
import { routes } from './navigation';

export function UserMenu() {
  const { user, signOut, isSigningOut } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  return (
    <Dropdown
      label="Open user menu"
      trigger={({ open }) => (
        <span className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-slate-100">
          <Avatar name={user.name} src={user.avatar ?? undefined} size="sm" />
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-medium leading-tight text-slate-900">{user.name}</span>
            <span className="block text-xs leading-tight text-slate-500">{user.email}</span>
          </span>
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </span>
      )}
    >
      <div className="border-b border-slate-200 px-3 pb-2.5 pt-1.5">
        <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>
        <p className="truncate text-xs text-slate-500">{user.email}</p>
      </div>
      <div className="pt-1.5">
        <DropdownItem icon={<UserRound className="h-4 w-4 text-slate-400" aria-hidden="true" />} onSelect={() => navigate(routes.settings)}>
          Your profile
        </DropdownItem>
        <DropdownItem icon={<Settings className="h-4 w-4 text-slate-400" aria-hidden="true" />} onSelect={() => navigate(routes.settings)}>
          Settings
        </DropdownItem>
        <DropdownItem icon={<LifeBuoy className="h-4 w-4 text-slate-400" aria-hidden="true" />} disabled>
          Support
        </DropdownItem>
      </div>
      <DropdownSeparator />
      <DropdownItem
        tone="danger"
        disabled={isSigningOut}
        icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
        onSelect={signOut}
      >
        {isSigningOut ? 'Signing out…' : 'Log out'}
      </DropdownItem>
    </Dropdown>
  );
}
