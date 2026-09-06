import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Toast, ToastViewport, type ToastData, type ToastVariant } from '../components/ui/Toast';

interface ToastContextValue {
  toast: (options: Omit<ToastData, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((options: Omit<ToastData, 'id'>) => {
    counter += 1;
    setToasts((current) => [...current, { ...options, id: `toast-${counter}` }].slice(-4));
  }, []);

  const push = useCallback(
    (variant: ToastVariant) => (title: string, description?: string) =>
      toast({ title, description, variant }),
    [toast],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toast, dismiss, success: push('success'), error: push('error') }),
    [toast, dismiss, push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport>
        {toasts.map((item) => (
          <Toast key={item.id} toast={item} onDismiss={dismiss} />
        ))}
      </ToastViewport>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}
