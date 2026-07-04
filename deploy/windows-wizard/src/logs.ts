import type { DeploymentConfig } from './config.js';
import { redactText } from './redact.js';

export type WizardLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export function createWizardLogger(config?: Partial<DeploymentConfig>): WizardLogger {
  return {
    info(message) {
      console.log(redactText(message, config));
    },
    warn(message) {
      console.warn(redactText(message, config));
    },
    error(message) {
      console.error(redactText(message, config));
    },
  };
}
