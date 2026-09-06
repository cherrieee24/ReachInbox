import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ComposeContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const ComposeContext = createContext<ComposeContextValue | null>(null);

/** Lets any screen open the shared "Compose New Email" dialog. */
export function ComposeProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo<ComposeContextValue>(() => ({ isOpen, open, close }), [isOpen, open, close]);

  return <ComposeContext.Provider value={value}>{children}</ComposeContext.Provider>;
}

export function useCompose(): ComposeContextValue {
  const context = useContext(ComposeContext);
  if (!context) throw new Error('useCompose must be used inside a ComposeProvider');
  return context;
}
