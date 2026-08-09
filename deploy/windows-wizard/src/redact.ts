import type { DeploymentConfig } from './config.js';
import path from 'node:path';

const GENERIC_SECRET_PATTERNS: RegExp[] = [
  /(password\s*[:=]\s*)[^\s,;]+/gi,
  /(passwd\s*[:=]\s*)[^\s,;]+/gi,
  /(pwd\s*[:=]\s*)[^\s,;]+/gi,
  /(setupToken\s*[:=]\s*)[^\s,;]+/gi,
  /(SETUP_TOKEN\s*[:=]\s*)[^\s,;]+/g,
  /(sessionSecret\s*[:=]\s*)[^\s,;]+/gi,
  /(SESSION_SECRET\s*[:=]\s*)[^\s,;]+/g,
  /(ENCRYPTION_KEY\s*[:=]\s*)[^\s,;]+/g,
  /(BACKUP_SIGNING_KEY\s*[:=]\s*)[^\s,;]+/g,
  /(token\s*[:=]\s*)[^\s,;]+/gi,
  /(secret\s*[:=]\s*)[^\s,;]+/gi,
  /(cookie\s*[:=]\s*)[^\s,;]+/gi,
  /(authorization\s*[:=]\s*)[^\s,;]+/gi,
  /(privateKey\s*[:=]\s*)[^\s,;]+/gi,
  /(privateKeyPath\s*[:=]\s*)[^\s,;]+/gi,
  /(DATABASE_URL\s*[:=]\s*)[^\s,;]+/g,
  /(postgres[_-]?password\s*[:=]\s*)[^\s,;]+/gi,
  /(ssh[_-]?password\s*[:=]\s*)[^\s,;]+/gi,
  /([?&](?:token|session|password|secret|key)=)[^&\s]+/gi,
];

export function secretValues(config?: Partial<DeploymentConfig>): string[] {
  return [config?.privateKeyPath].filter((value): value is string => Boolean(value));
}

export function redactPrivateKeyPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return `[basename:${path.basename(value)}]`;
}

export function redactText(value: string, config?: Partial<DeploymentConfig>): string {
  let output = value;
  for (const secret of secretValues(config)) {
    if (secret) output = output.split(secret).join('[REDACTED]');
  }
  for (const pattern of GENERIC_SECRET_PATTERNS) {
    output = output.replace(pattern, '$1[REDACTED]');
  }
  return output;
}

export function redactJson<T>(value: T, config?: Partial<DeploymentConfig>): T {
  return JSON.parse(redactText(JSON.stringify(value), config)) as T;
}
