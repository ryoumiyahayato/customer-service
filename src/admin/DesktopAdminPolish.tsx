import { useEffect, useState } from 'react';
import './desktopAdminPolish.css';

const DESKTOP_QUERY = '(min-width: 821px)';

export default function DesktopAdminPolish() {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  const [hasSessionDetails, setHasSessionDetails] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const sync = () => {
      const next = media.matches;
      setDesktop(next);
      if (!next) setDetailsOpen(false);
    };
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const sync = () => {
      const exists = Boolean(document.querySelector('.admin:not(.is-narrow) .session-action-bar'));
      setHasSessionDetails(exists);
      if (!exists) setDetailsOpen(false);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const className = 'admin-desktop-details-open';
    document.body.classList.toggle(className, desktop && detailsOpen);
    return () => document.body.classList.remove(className);
  }, [desktop, detailsOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false);
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, []);

  if (!desktop || !hasSessionDetails) return null;

  return (
    <>
      <button
        type="button"
        className="desktop-session-details-button"
        onClick={() => setDetailsOpen(true)}
        aria-expanded={detailsOpen}
      >
        会话详情
      </button>
      {detailsOpen ? (
        <>
          <button
            type="button"
            className="desktop-session-details-backdrop"
            aria-label="关闭会话详情"
            onClick={() => setDetailsOpen(false)}
          />
          <button
            type="button"
            className="desktop-session-details-close"
            aria-label="关闭会话详情"
            onClick={() => setDetailsOpen(false)}
          >
            ×
          </button>
        </>
      ) : null}
    </>
  );
}
