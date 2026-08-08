import { useLayoutEffect } from 'react';

export default function LinkExpired() {
  useLayoutEffect(() => {
    window.dispatchEvent(new CustomEvent('visitor:presentation', { detail: null }));
  }, []);

  return (
    <main className="link-expired-page" aria-label="404 Not Found">
      <h1>404 Not Found</h1>
    </main>
  );
}
