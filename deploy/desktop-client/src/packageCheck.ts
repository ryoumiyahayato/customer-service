import { access } from 'node:fs/promises';
import path from 'node:path';

export type PackageCheck = {
  ok: true;
  checks: Array<{ name: string; status: 'pass' | 'warn'; detail: string }>;
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function runPackageCheck(): Promise<PackageCheck> {
  const cwd = process.cwd();
  const checks: PackageCheck['checks'] = [];

  checks.push({
    name: 'package.json',
    status: (await exists(path.join(cwd, 'package.json'))) ? 'pass' : 'warn',
    detail: 'desktop-client package manifest',
  });
  checks.push({
    name: 'examples/client-config.example.json',
    status: (await exists(path.join(cwd, 'examples', 'client-config.example.json'))) ? 'pass' : 'warn',
    detail: 'example config with placeholder URLs',
  });
  checks.push({
    name: 'tauri-project',
    status: (await exists(path.join(cwd, 'src-tauri', 'tauri.conf.json'))) ? 'pass' : 'warn',
    detail: 'Tauri project is optional in this MVP; package steps are documented but no EXE is produced here.',
  });

  return {
    ok: true,
    checks,
  };
}
