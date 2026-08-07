# Cloudflare Git deployment

This repository is connected to the `support-chat-cloudflare` Worker through Cloudflare Workers Builds.

- Production branch: `main`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Non-production command: `npx wrangler versions upload`
- Root directory: `/`

This document records the deployment connection and provides a harmless repository change for validating the first automatic Git-triggered Cloudflare build.
