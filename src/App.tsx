import { useEffect, useState } from 'react';
import AdminApp from './apps/AdminApp';
import VisitorApp from './apps/VisitorApp';
import LinkExpired from './common/LinkExpired';
import NotFound from './common/NotFound';
import { resolveAppMode, type AppMode } from './routing';

export default function App() {
  const [mode, setMode] = useState<AppMode>(() => resolveAppMode(window.location));

  useEffect(() => {
    const onPopState = () => setMode(resolveAppMode(window.location));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (mode.type === 'admin') return <AdminApp />;
  if (mode.type === 'visitor') return <VisitorApp token={mode.token} />;
  if (mode.type === 'reserved-short-link') return <LinkExpired />;
  return <NotFound />;
}
