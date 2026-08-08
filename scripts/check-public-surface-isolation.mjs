import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = 'dist/visitor';
if (!existsSync(root)) throw new Error('visitor build output is missing');

const forbidden = [
  'denglu.kefuxitong.net',
  '/api/auth/login',
  '/api/admin/security',
  '/api/admin/operator-policies',
  '/api/admin/operators/',
  'AdminRiskCenter',
  'SUPER_ADMIN',
  'reset-password',
  '客服管理',
  '风控与安全',
];

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
}
walk(root);

const inspectable = files.filter(path => /\.(?:html|js|css|json|webmanifest)$/i.test(path));
for (const path of inspectable) {
  const text = readFileSync(path, 'utf8');
  for (const marker of forbidden) {
    if (text.includes(marker)) {
      throw new Error(`visitor asset ${relative(root, path)} exposes forbidden admin marker: ${marker}`);
    }
  }
}

const htmlPath = join(root, 'visitor.html');
if (!existsSync(htmlPath)) throw new Error('visitor.html was not emitted');
const html = readFileSync(htmlPath, 'utf8');
if (!html.includes('/visitor/')) throw new Error('visitor HTML does not use the isolated /visitor/ asset prefix');
if (html.includes('/assets/')) throw new Error('visitor HTML references the admin asset namespace');

console.log(`Visitor surface isolation OK (${inspectable.length} inspectable files).`);
