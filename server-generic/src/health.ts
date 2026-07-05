import type { GenericServerConfig } from './config.js';
import { safeConfigSummary } from './config.js';

export function healthPayload(config: GenericServerConfig) {
  return {
    ok: true,
    runtime: 'server-generic',
    uptimeSeconds: Math.floor(process.uptime()),
    config: safeConfigSummary(config),
  };
}
