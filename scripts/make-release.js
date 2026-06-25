const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = process.cwd();
const outRoot = path.join(root, 'release');
const out = path.join(outRoot, 'support-system');
const include = ['app','lib','public','scripts','docs','package.json','next.config.js','tsconfig.json','next-env.d.ts','declarations.d.ts','README.md','START_HERE.md','.env.example'];

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const item of include) {
  const src = path.join(root, item);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(out, item), { recursive: true });
}
fs.writeFileSync(path.join(out, 'README_START_HERE.txt'), '请先阅读 START_HERE.md，然后按 README.md 部署。\n访客端：/\n客服后台：/admin\n');
try {
  execFileSync('zip', ['-qr', path.join(outRoot, 'support-system.zip'), 'support-system'], { cwd: outRoot, stdio: 'inherit' });
  console.log('Release created: release/support-system.zip');
} catch {
  console.log('Release folder created: release/support-system');
  console.log('zip command not found; you can manually compress the folder.');
}
