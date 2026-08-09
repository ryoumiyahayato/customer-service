import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('desktop customer-service management owns a visible create form in the new settings shell', async () => {
  const shell = await read('src/admin/DesktopAdminPolish.tsx');
  const manager = await read('src/admin/DesktopOperatorManagement.tsx');

  assert.match(shell, /import DesktopOperatorManagement/);
  assert.match(shell, /settingsPage === 'operators' \|\| settingsPage === 'security'/);
  assert.match(shell, /<DesktopOperatorManagement initialOperators=\{operators\} \/>/);
  assert.doesNotMatch(shell, /page === 'operators'[\s\S]{0,120}openView\('operators'\)/);
  assert.match(shell, /desktop-admin-settings-legacy', desktop && mode === 'settings' && settingsPage === 'staff'/);

  assert.match(manager, /<h3 className="panel-title">新增客服<\/h3>/);
  assert.match(manager, /name="username"/);
  assert.match(manager, /name="password"/);
  assert.match(manager, /apiFetch\('\/api\/admins', \{ method: 'POST'/);
  assert.match(manager, /apiFetch<OperatorListResponse>\('\/api\/admins\/operators'/);
});

test('desktop operator creation stays first in the management panel and is not hidden by legacy layout', async () => {
  const css = await read('src/admin/desktopAdminPolish.css');
  assert.match(css, /\.desktop-settings-content>\.desktop-operator-manager/);
  assert.match(css, /\.desktop-operator-manager\{display:grid;gap:20px/);
  assert.match(css, /\.desktop-operator-create-form\{grid-template-columns:/);
  assert.match(css, /Staff chat is the remaining settings page that reuses legacy dashboard content/);
});
