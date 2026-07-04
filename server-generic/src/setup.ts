import type { GenericServerConfig } from './config.js';

export type SetupStatus = {
  ok: true;
  setupAvailable: boolean;
  requiresSetupToken: boolean;
  reason: 'already_configured' | 'missing_setup_token' | 'no_admins' | 'generic_adapter_placeholder';
};

export type SetupDependencies = {
  hasAnyAdmin: () => Promise<boolean>;
};

export async function getSetupStatus(config: GenericServerConfig, deps: SetupDependencies): Promise<SetupStatus> {
  const hasAdmin = await deps.hasAnyAdmin();
  if (hasAdmin) {
    return {
      ok: true,
      setupAvailable: false,
      requiresSetupToken: false,
      reason: 'already_configured',
    };
  }

  if (!config.setupToken) {
    return {
      ok: true,
      setupAvailable: false,
      requiresSetupToken: true,
      reason: 'missing_setup_token',
    };
  }

  return {
    ok: true,
    setupAvailable: true,
    requiresSetupToken: true,
    reason: 'no_admins',
  };
}

export async function initializeSetup() {
  throw new Error('Setup initialize is intentionally not implemented in the generic adapter skeleton.');
}
