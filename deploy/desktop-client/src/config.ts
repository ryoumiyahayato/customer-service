import { readFile } from 'node:fs/promises';

export type DesktopClientMode = 'admin' | 'visitor' | 'auto';

export type DesktopClientConfig = {
  appName: string;
  adminUrl: string;
  visitorRootUrl?: string;
  mode: DesktopClientMode;
  rememberWindowState: boolean;
  allowExternalOpen: boolean;
};

export async function loadDesktopClientConfig(filePath: string): Promise<DesktopClientConfig> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as DesktopClientConfig;
}
