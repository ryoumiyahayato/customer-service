import { useCallback, useEffect, useRef } from 'react';
import { ApiError, apiFetch } from '../api';

type AuthResponse = { admin?: { username?: string; role?: string } | null };

export default function useAdminSessionHeartbeat(enabled: boolean) {
  const inFlightRef = useRef(false);
  const reloadingRef = useRef(false);

  const reloadForExpiredSession = useCallback(() => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    window.location.reload();
  }, []);

  const check = useCallback(async () => {
    if (!enabled || document.visibilityState !== 'visible' || inFlightRef.current || reloadingRef.current) return;
    inFlightRef.current = true;
    try {
      const response = await apiFetch<AuthResponse>('/api/auth/me', {
        retryGet: false,
        timeoutMs: 5000,
      });
      if (!response.admin) reloadForExpiredSession();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) reloadForExpiredSession();
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled, reloadForExpiredSession]);

  useEffect(() => {
    if (!enabled) return;

    void check();
    const timer = window.setInterval(() => { void check(); }, 2000);
    const onFocus = () => { void check(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check();
    };
    addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [check, enabled]);
}
