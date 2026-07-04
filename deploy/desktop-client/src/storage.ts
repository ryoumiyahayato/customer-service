import type { DesktopClientConfig } from './config.js';

export type PublicDesktopClientConfig = DesktopClientConfig;

export type ClientConfigStore = {
  savePublicConfig: (config: PublicDesktopClientConfig) => Promise<void>;
  loadPublicConfig: () => Promise<PublicDesktopClientConfig | null>;
};

export function createMemoryConfigStore(): ClientConfigStore {
  let current: PublicDesktopClientConfig | null = null;
  return {
    async savePublicConfig(config) {
      current = { ...config };
    },
    async loadPublicConfig() {
      return current ? { ...current } : null;
    },
  };
}

export const exampleConfig: PublicDesktopClientConfig = {
  appName: '客服系统',
  adminUrl: 'https://admin.example.com/',
  visitorRootUrl: 'https://visitor.example.com/',
  mode: 'auto',
  rememberWindowState: true,
  allowExternalOpen: false,
};
