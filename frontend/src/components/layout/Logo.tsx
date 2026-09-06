import { Send } from 'lucide-react';
import { cn } from '../../utils/cn';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
        <Send className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-slate-900">
        Reach<span className="text-brand-600">Inbox</span>
      </span>
    </span>
  );
}
