// Deployed 2026-06-30T09:17:23.404Z
import { ChatRoom } from './durable-objects/ChatRoom';

export { ChatRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname;
    const pathname = url.pathname;

    // =========================================================
    // Always block non-visitor /api/* on the root domain
    // Only admin-facing API allowed on root domain.
    // =========================================================
    if (pathname.startsWith('/api/')) {
      // If this is a visitor domain host but not root domain, block API access entirely
      // (visitors shouldn't call admin API)
      if (hostname !== DOMAIN && hostname.endsWith('.' + DOMAIN)) {
        return nullResponse(404);
      }
    }

    // =========================================================
    // Visitor domain gate: *.vx9qn7zr.org
    // =========================================================
    if (hostname !== DOMAIN && hostname.endsWith('.' + DOMAIN)) {
      // Extract the subdomain
      const subdomain = hostname.slice(0, -DOMAIN.length - 1); // remove ".vx9qn7zr.org"

      // Block any non-40hex subdomain immediately
      if (subdomain !== '' && !isValidHex40(subdomain)) {
        return nullResponse(404);
      }

      // For 40-hex subdomains, check if invite exists and is valid
      if (isValidHex40(subdomain)) {
        const inviteId = subdomain.toLowerCase();
        
        // Check the invite in DB
        const invite: any = await env.DB.prepare('SELECT id, created_at, deleted_at FROM invites WHERE id = ?').bind(inviteId).first().catch(() => null);
        
        // If invite doesn't exist or is deleted → 410 Gone
        if (!invite || invite.deleted_at !== null) {
          return nullResponse(410);
        }
        
        // If invite is expired (older than 24h) → 410 Gone
        try {
          const age = Date.now() - new Date(invite.created_at + 'Z').getTime();
          if (isNaN(age) || age > INVITE_TTL_MS) {
            return nullResponse(410);
          }
        } catch {
          // If date parsing fails, treat as expired
          return nullResponse(410);
        }
        
        // Valid invite — check if there's already a session for this invite
        const session: any = await env.DB.prepare('SELECT id, status FROM chat_sessions WHERE invite_id = ? AND status = \'active\'').bind(inviteId).first().catch(() => null);
        
        // If session exists and is active, pass through to SPA
        // If no session yet, also pass through (will be created by frontend)
        // Allow the ASSETS fetch to proceed
      } else {
        // This case shouldn't happen since we validated above
        return nullResponse(404);
      }
    }

    // =========================================================
    // Non-API requests: serve SPA assets or admin app
    // =========================================================
    try {
      // Fetch asset response
      const assetResponse = await env.ASSETS.fetch(request);
      
      // Clone and add no-cache headers to prevent Cloudflare edge cache
      // from serving stale SPA for visitor subdomains
      const headers = new Headers(assetResponse.headers);
      headers.set('cache-control', 'no-cache, no-store, must-revalidate');
      headers.set('pragma', 'no-cache');
      headers.set('expires', '0');
      
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    } catch (e) {
      // If ASSETS fails, return 404
      return nullResponse(404);
    }
  },
};
