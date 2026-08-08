import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, got ${count}`);
  return source.replace(before, after);
}

{
  const path = 'src/admin/AdminDashboard.tsx';
  let source = readFileSync(path, 'utf8');
  source = source.split('wsAdminRef.current').join('wsRefs.current.admin');
  const generated = `{capabilities.canUploadImages ? <label className="file-btn"><span aria-hidden="true">⌘</span><input ref={uploadRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label> : null}`;
  const actual = `{capabilities.canUploadImages ? <label className="file-btn">{uploadButtonLabel}<input type="file" name="image" accept="image/jpeg,image/png,image/webp" disabled={sending === 'image'} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></label> : null}`;
  const count = source.split(generated).length - 1;
  if (count !== 2) throw new Error(`capability image controls: expected two matches, got ${count}`);
  source = source.split(generated).join(actual);
  writeFileSync(path, source);
}

{
  const path = 'src/durable-objects/ChatRoom.ts';
  let source = readFileSync(path, 'utf8');
  source = source.replace("import { parseStoredOperatorPolicy } from '../security/operatorPolicy';\n\n", '');
  source = replaceOnce(source,
    `type StaffAccessRow = {\n  role: string;\n  policy_json: string | null;\n};`,
    `type StaffAccessRow = {\n  role: string;\n  can_use_staff_chat: number | null;\n};`,
    'staff access row');
  source = replaceOnce(source,
    `      \`SELECT a.role,\n              (SELECT value_json FROM settings WHERE key=('operator_policy:' || a.id) LIMIT 1) policy_json\n         FROM admins a\n         JOIN admin_sessions auth ON auth.id=? AND auth.admin_id=a.id`,
    `      \`SELECT a.role,p.can_use_staff_chat\n         FROM admins a\n         JOIN admin_sessions auth ON auth.id=? AND auth.admin_id=a.id\n         LEFT JOIN operator_policies p ON p.admin_id=a.id`,
    'staff typed policy query');
  source = replaceOnce(source,
    `    return parseStoredOperatorPolicy(row.policy_json).canUseStaffChat;`,
    `    return row.can_use_staff_chat === 1;`,
    'staff typed policy decision');
  writeFileSync(path, source);
}

{
  const path = 'src/worker-public-gate.ts';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    `      if (adminLegacyVisitorApi(url.pathname)) return notFound('admin');`,
    `      if (url.pathname === '/g' || url.pathname.startsWith('/g/') || adminLegacyVisitorApi(url.pathname)) return notFound('admin');`,
    'outer admin legacy visitor path rejection',
  );
  writeFileSync(path, source);
}

console.log('aligned transformed runtime consumers with typed P2 state');
