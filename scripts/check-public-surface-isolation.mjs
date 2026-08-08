import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = 'dist/visitor';
if (!existsSync(root)) throw new Error('visitor build output is missing');

const forbidden = [
  'denglu.kefuxitong.net',
  '/api/auth/login',
  '/api/auth/me',
  '/api/admin/security',
  '/api/admin/operator-policies',
  '/api/admin/operators/',
  '/api/admins/profile',
  '/api/operators',
  '/api/staff-chat',
  '/api/ws/staff',
  'AdminRiskCenter',
  'SUPER_ADMIN',
  'reset-password',
  'admin-login',
  'setup-page',
  'desktop-admin',
  'mobile-admin',
  'risk-center',
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
let inspectableBytes = 0;
for (const path of inspectable) {
  const text = readFileSync(path, 'utf8');
  inspectableBytes += Buffer.byteLength(text);
  for (const marker of forbidden) {
    if (text.includes(marker)) {
      throw new Error(`visitor asset ${relative(root, path)} exposes forbidden admin marker: ${marker}`);
    }
  }
  if (/\.map$/i.test(path)) throw new Error(`visitor source map must not be public: ${relative(root, path)}`);
}

const htmlPath = join(root, 'visitor.html');
if (!existsSync(htmlPath)) throw new Error('visitor.html was not emitted');
const html = readFileSync(htmlPath, 'utf8');
if (!html.includes('/visitor/')) throw new Error('visitor HTML does not use the isolated /visitor/ asset prefix');
if (/\b(?:src|href)=["']\/assets\//i.test(html)) throw new Error('visitor HTML references the admin asset namespace');
if (/manifest\.webmanifest|serviceWorker|apple-touch-icon/i.test(html)) throw new Error('visitor HTML exposes admin/PWA discovery surface');

const cssFiles = inspectable.filter(path => path.endsWith('.css'));
if (!cssFiles.length) throw new Error('visitor CSS output is missing');
const cssBytes = cssFiles.reduce((total, path) => total + statSync(path).size, 0);
if (cssBytes > 24 * 1024) {
  throw new Error(`visitor CSS surface is unexpectedly large (${cssBytes} bytes); admin/global styles may have leaked`);
}

console.log(`Visitor surface isolation OK (${inspectable.length} files, ${inspectableBytes} inspectable bytes, ${cssBytes} CSS bytes).`);
