import type { ReactNode } from 'react';

type StatusBlockProps = {
  children: ReactNode;
  title?: ReactNode;
  className?: string;
};

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function LoadingState({ children, className = 'empty-state' }: StatusBlockProps) {
  return (
    <div className={cx('ui-loading-state', className)}>
      <span className="spinner" /> {children}
    </div>
  );
}

export function StatusBlock({ title, children, className }: StatusBlockProps) {
  return (
    <div className={cx('empty-state ui-status-block', className)}>
      {title ? <b>{title}</b> : null}
      <span>{children}</span>
    </div>
  );
}
