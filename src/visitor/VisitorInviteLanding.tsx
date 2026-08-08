import { useEffect, useState, type CSSProperties } from 'react';
import GuestChat from './GuestChat';
import './visitorPresentation.css';

type VisitorInviteLandingProps = {
  token: string;
};

type OperatorPresentation = {
  displayName?: string;
  welcomeText?: string;
  avatarUrl?: string;
};

export default function VisitorInviteLanding({ token }: VisitorInviteLandingProps) {
  const [presentation, setPresentation] = useState<OperatorPresentation | null>(null);

  useEffect(() => {
    setPresentation(null);
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
        setPresentation(null);
        return;
      }
      const value = detail as Record<string, unknown>;
      setPresentation({
        displayName: typeof value.displayName === 'string' ? value.displayName : '',
        welcomeText: typeof value.welcomeText === 'string' ? value.welcomeText : '',
        avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : '',
      });
    };
    window.addEventListener('visitor:presentation', receive);
    return () => {
      window.removeEventListener('visitor:presentation', receive);
      setPresentation(null);
    };
  }, [token]);

  if (!token) return null;

  const avatarUrl = String(presentation?.avatarUrl || '');
  const welcomeText = String(presentation?.welcomeText || '').trim();
  const displayName = String(presentation?.displayName || '在线客服').trim() || '在线客服';
  const shellClass = [
    'personalized-visitor-shell',
    presentation ? 'has-operator' : '',
    avatarUrl ? 'has-avatar' : '',
    welcomeText ? 'has-welcome' : '',
  ].filter(Boolean).join(' ');
  const avatarStyle = avatarUrl
    ? ({ '--operator-avatar-url': `url("${avatarUrl}")` } as CSSProperties)
    : undefined;

  return (
    <div className={shellClass} style={avatarStyle}>
      <GuestChat token={token} />
      {presentation ? (
        <div className="operator-identity-overlay" aria-label={`当前客服：${displayName}`}>
          <div className="visitor-operator-avatar" aria-hidden="true">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{displayName.slice(0, 1)}</span>}
          </div>
          <b>{displayName}</b>
        </div>
      ) : null}
      {welcomeText ? (
        <div className="operator-welcome-overlay">
          <div className="operator-welcome-avatar" aria-hidden="true">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{displayName.slice(0, 1)}</span>}
          </div>
          <div className="operator-welcome-content">
            <b>{displayName}</b>
            <p>{welcomeText}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
