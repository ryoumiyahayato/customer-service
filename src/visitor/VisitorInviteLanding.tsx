import { useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../api';
import GuestChat from './GuestChat';
import '../admin/operatorPresentation.css';

type VisitorInviteLandingProps = {
  token: string;
};

type OperatorPresentation = {
  operatorId?: string;
  displayName?: string;
  welcomeText?: string;
  avatarUrl?: string;
};

type PresentationResponse = { presentation?: OperatorPresentation | null };

const presentationRequests = new Map<string, Promise<PresentationResponse>>();

export default function VisitorInviteLanding({ token }: VisitorInviteLandingProps) {
  const [presentation, setPresentation] = useState<OperatorPresentation | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    let request = presentationRequests.get(token);
    if (!request) {
      request = apiFetch<PresentationResponse>(`/api/invite-presentation/${encodeURIComponent(token)}`, { retryGet: false });
      presentationRequests.set(token, request);
    }
    request
      .then(res => { if (active) setPresentation(res?.presentation || null); })
      .catch(() => { if (active) setPresentation(null); });
    return () => { active = false; };
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
