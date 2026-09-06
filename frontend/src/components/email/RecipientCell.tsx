import { Avatar } from '../ui/Avatar';

export interface RecipientCellProps {
  email: string;
}

export function RecipientCell({ email }: RecipientCellProps) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={email} size="sm" />
      <p className="truncate text-sm font-medium text-slate-900">{email}</p>
    </div>
  );
}
