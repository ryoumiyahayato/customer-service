import type { DesktopClientConfig } from './config.js';
import { generateClientPlan } from './clientPlan.js';

export type LaunchResult = {
  ok: true;
  openedUrl: string;
  mode: DesktopClientConfig['mode'];
};

export async function openClientTarget(config: DesktopClientConfig): Promise<LaunchResult> {
  const plan = generateClientPlan(config);
  return {
    ok: true,
    openedUrl: plan.targetUrl,
    mode: plan.mode,
  };
}
