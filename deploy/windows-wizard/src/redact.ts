import type { DeploymentConfig } from './config.js';

const GENERIC_SECRET_PATTERNS: RegExp[] = [
  /(password\s*[:=]\s*)[^\s,;]+/gi,
  /(setupToken\s*[:=]\s*)[^\s,;]+/gi,
  /(sessionSecret\s*[:=]\s*)[^\s,;]+/gi,
  /(token\s*[:=]\s*)[^\s,;]+/gi,
  /(cookie\s*[:=]\s*)[^\s,;]+/gi,
  /(privateKey\s*[:=]\s*)[^\s,;]+/gi,
  /(DATABASE_URL\s*[:=]\s*)[^\s,;]+/g,
];

export function secretValues(config?: Partial<DeploymentConfig>): string[] {
  return [
    config?.password,
    config?.setupToken,
    config?.sessionSecret,
    config?.privateKeyPath,
  ].filter((value): value is string => Boolean(value));
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
