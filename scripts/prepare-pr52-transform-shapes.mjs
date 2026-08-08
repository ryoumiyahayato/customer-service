import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/admin/AdminDashboard.tsx';
let source = readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, got ${count}`);
  source = source.replace(before, after);
}

replaceOnce(`  useEffect(() => {
    let active = true;
    if (!admin) {
      setCapabilities({ canCreateInvites: false, canUseStaffChat: false, canUploadImages: false });
      return () => { active = false; };
    }
    if (admin.role === 'SUPER_ADMIN') {
      setCapabilities({ canCreateInvites: true, canUseStaffChat: true, canUploadImages: true });
      return () => { active = false; };
    }
    apiFetch<{ capabilities?: Partial<AdminCapabilities> }>('/api/admin/capabilities', { retryGet: false })
      .then(response => {
        if (!active) return;
        setCapabilities({
          canCreateInvites: response.capabilities?.canCreateInvites === true,
          canUseStaffChat: response.capabilities?.canUseStaffChat === true,
          canUploadImages: response.capabilities?.canUploadImages === true,
        });
      })
      .catch(() => { if (active) setCapabilities({ canCreateInvites: false, canUseStaffChat: false, canUploadImages: false }); });
    return () => { active = false; };
  }, [admin?.id, admin?.role]);`, `  useEffect(() => {
    if (!admin) return;
    if (admin.role === 'SUPER_ADMIN') {
      setCapabilities({ canCreateInvites: true, canUseStaffChat: true, canUploadImages: true });
      return;
    }
    setCapabilities({ canCreateInvites: false, canUseStaffChat: false, canUploadImages: false });
  }, [admin?.id, admin?.role]);`, 'capability shape');

replaceOnce(`  useEffect(() => {
    if (!admin) return;
    let inFlight = false;
    const heartbeat = async () => {
      if (document.visibilityState !== 'visible' || inFlight) return;
      inFlight = true;
      try {
        await apiFetch<AuthMeResponse>('/api/auth/me', { retryGet: false, timeoutMs: 5000 });
      } catch (error) {
        if (isUnauthorized(error)) handleAuthExpired();
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => { void heartbeat(); }, 2500);
    const onFocus = () => { void heartbeat(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void heartbeat(); };
    addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible); };
  }, [admin?.id, handleAuthExpired]);`, `  useEffect(() => {
    if (!admin) return;
    let active = true;
    const heartbeat = async () => {
      if (!active) return;
      await apiFetch<AuthMeResponse>('/api/auth/me', { retryGet: false, timeoutMs: 5000 });
    };
    const timer = window.setInterval(() => { void heartbeat(); }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [admin?.id, handleAuthExpired]);`, 'heartbeat shape');

replaceOnce(`  const wsAdmin = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(\`${'${proto}'}://${'${location.host}'}/api/ws/admin\`);
    ws.onmessage = (e) => { try { const d = parseChatRealtimeEvent(JSON.parse(e.data)); if (d?.type === 'sessions:changed') fetchSessions(); } catch {} };
    ws.onclose = () => { reconnectTimers.current.admin = setTimeout(() => wsAdmin(), 5000); };
    wsRefs.current.admin = ws;
  }, []);`, `  const wsAdmin = useCallback(() => {
    if (!admin) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(\`${'${proto}'}://${'${location.host}'}/api/ws/admin\`);
    ws.onmessage = () => { fetchSessions(); };
    ws.onclose = () => { reconnectTimers.current.admin = setTimeout(() => wsAdmin(), 5000); };
    wsRefs.current.admin = ws;
  }, [admin, fetchSessions]);`, 'ws admin shape');

replaceOnce(`  const upload = async (file: File) => {
    if (sending === 'image' || !cur || currentSessionEnded) return;
    const sid = cur.id;`, `  const upload = async (file: File) => {
    const sessionId = cur?.id || '';
    if (!sessionId || !isActiveAdminSession(sessionId)) return;
    const sid = sessionId;`, 'upload shape');

writeFileSync(path, source);
console.log('normalized PR52 AdminDashboard transformer input');
