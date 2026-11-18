import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

type BannerKind = 'info' | 'warning' | 'error' | 'success';

const BANNER_ICON: Record<BannerKind, IconName> = {
  info: 'info',
  warning: 'alert',
  error: 'alert',
  success: 'check',
};

/** A message inside the page. Errors are announced to screen readers. */
export function Banner({
  kind,
  children,
  onDismiss,
}: {
  kind: BannerKind;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={BANNER_ICON[kind]} size={16} />
      <div className="banner-body">{children}</div>
      {onDismiss && (
        <button className="btn btn-icon" aria-label="Dismiss" data-tip="Dismiss" onClick={onDismiss}>
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark">
        <Icon name={icon} size={20} />
      </span>
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function PageHead({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-row">
        <h1 className="page-title">{title}</h1>
        {actions}
      </div>
      {description && <p className="page-desc">{description}</p>}
    </header>
  );
}

/** A copy button that confirms for a moment after copying. */
export function CopyButton({ text, label, onCopy }: { text: string; label: string; onCopy(text: string): void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className={`btn btn-icon${copied ? ' copied' : ''}`}
      aria-label={label}
      data-tip={copied ? 'Copied' : label}
      onClick={() => {
        onCopy(text);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={18} />
    </button>
  );
}

/**
 * Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern).
 * Use with a roving tabIndex: only the selected tab is in the Tab order.
 */
export function onTabKeys(event: KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const tabs = [...(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'))];
  const current = tabs.indexOf(document.activeElement as HTMLElement);
  if (current < 0) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]!.focus();
  tabs[next]!.click();
}

/** Ask before a destructive action. Resolves true only when the owner confirms. */
export type Confirm = (question: string, action?: string) => boolean | Promise<boolean>;

interface Pending {
  question: string;
  action: string;
  resolve(ok: boolean): void;
}

const ConfirmContext = createContext<Confirm | null>(null);

/** The confirm function from the nearest ConfirmProvider, or the browser's own dialog. */
export function useConfirm(): Confirm {
  return useContext(ConfirmContext) ?? ((question) => window.confirm(question));
}

/**
 * Confirmation dialog for destructive actions: names what will be lost, the
 * button repeats the action, Cancel has focus, Escape cancels, and focus
 * returns to the button that opened it.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<Confirm>(
    (question, action = 'Delete') =>
      new Promise<boolean>((resolve) => {
        opener.current = document.activeElement as HTMLElement | null;
        setPending({ question, action, resolve });
      }),
    [],
  );

  useEffect(() => {
    const el = dialog.current;
    if (pending && el && !el.open) el.showModal?.();
    // Cancel is the safe default.
    if (pending) cancel.current?.focus();
  }, [pending]);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
    dialog.current?.close?.();
    opener.current?.focus?.();
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <dialog
          ref={dialog}
          className="dialog"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-body"
          onCancel={(e) => {
            e.preventDefault();
            close(false);
          }}
        >
          <h2 className="card-title" id="confirm-title">
            {pending.action}?
          </h2>
          <p id="confirm-body">{pending.question}</p>
          <div className="dialog-actions">
            <button className="btn" ref={cancel} onClick={() => close(false)}>
              Cancel
            </button>
            <button className="btn btn-danger-solid" onClick={() => close(true)}>
              {pending.action}
            </button>
          </div>
        </dialog>
      )}
    </ConfirmContext.Provider>
  );
}
