import type { ReactNode } from 'react';

type NoticeTone = 'default' | 'success' | 'warning' | 'error';

type NoticeProps = {
  children: ReactNode;
  tone?: NoticeTone;
  onDismiss?: () => void;
  dismissLabel?: string;
};

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function InlineNotice({ children, onDismiss, dismissLabel = '关闭' }: NoticeProps) {
  return (
    <div className="notice">
      {children}
      {onDismiss ? <button type="button" className="notice-dismiss" onClick={onDismiss}>{dismissLabel}</button> : null}
    </div>
  );
}

export function NetworkNotice({ children, tone = 'default', onDismiss, dismissLabel = '关闭' }: NoticeProps) {
  return (
    <div className={cx('network-banner', tone === 'error' && 'error-banner')}>
      {children}
      {onDismiss ? <button type="button" onClick={onDismiss}>{dismissLabel}</button> : null}
    </div>
  );
}

export function SetupNotice({ children, tone = 'default' }: NoticeProps) {
  return <p className={cx('setup-notice', tone !== 'default' && tone)}>{children}</p>;
}

export function FormError({ children }: { children: ReactNode }) {
  return <p className="form-error">{children}</p>;
}
