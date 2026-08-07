#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
const repository = read('src/repositories/sessionRepository.ts');
const service = read('src/services/sessionService.ts');
const state = read('src/domain/sessionState.ts');
const unit = read('tests/unit/sessionState.test.mjs');
const worker = read('src/runtimeWorker.ts');
const integration = [
  'tests/helpers/tsExtensionLoader.mjs',
  'tests/helpers/sqliteD1Adapter.mjs',
  'tests/helpers/sessionTransitionHarness.mjs',
  'tests/integration/sessionTransitions.sqlite.test.mjs',
  'tests/integration/sessionTransitions.runner.mjs',
  'tests/integration/sessionTransitions.basic.mjs',
  'tests/integration/sessionTransitions.duplicates.mjs',
  'tests/integration/sessionTransitions.stale.mjs',
  'tests/integration/sessionTransitions.purge.mjs',
].map(read).join('\n');

function block(name, nextName) {
  const start = repository.indexOf(`  ${name}(`);
  const end = nextName ? repository.indexOf(`\n  ${nextName}(`, start + 1) : repository.length;
  return start >= 0 && end > start ? repository.slice(start, end) : '';
}

const checks = [
  ['assign guards active source state', block('assign', 'archive'), ['deleted_at IS NULL', 'purged_at IS NULL', 'archived_at IS NULL', "status IN ('PENDING','OPEN')"]],
  ['archive guards active source state', block('archive', 'unarchive'), ['deleted_at IS NULL', 'purged_at IS NULL', 'archived_at IS NULL', "status IN ('PENDING','OPEN')"]],
  ['unarchive guards archived source state', block('unarchive', 'moveToTrash'), ['deleted_at IS NULL', 'purged_at IS NULL', 'archived_at IS NOT NULL', "status IN ('ARCHIVED','CLOSED')"]],
  ['moveToTrash guards archived source state', block('moveToTrash', 'restore'), ['deleted_at IS NULL', 'purged_at IS NULL', 'archived_at IS NOT NULL', "status IN ('ARCHIVED','CLOSED')"]],
  ['legacy repository restore remains state-guarded while service blocks product use', block('restore'), ['deleted_at IS NOT NULL', 'purged_at IS NULL']],
];

let failed = 0;
for (const [name, source, required] of checks) {
  const ok = required.every((value) => source.includes(value));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}

const behavioralChecks = [
  ['service converts zero-row writes to SESSION_STATE_CONFLICT', service.includes('Number(result.meta?.changes || 0) !== 1') && service.includes("new DomainError('SESSION_STATE_CONFLICT', 409)")],
  ['service rejects restore as an unsupported product action', service.includes("action === 'restore'") && service.includes("new DomainError('RESTORE_NOT_SUPPORTED', 410)")],
  ['unknown states fail closed', state.includes("state.status === 'PENDING' || state.status === 'OPEN'") && state.includes("return 'archived';") && unit.includes('fails closed for unknown or missing stored statuses')],
  ['integration loads production repository and service source', integration.includes("from '../../src/repositories/sessionRepository.ts'") && integration.includes("from '../../src/services/sessionService.ts'") && integration.includes('tsExtensionLoader.mjs')],
  ['integration does not copy lifecycle SQL functions', !/function\s+(assign|archive|unarchive|moveToTrash|restore)\s*\(/.test(integration)],
  ['integration covers stale reads and duplicate conflicts', integration.includes('rejects stale assign and archive writes') && integration.includes('rejects stale moveToTrash') && integration.includes('duplicate archive and trash operations') && integration.includes('SESSION_STATE_CONFLICT')],
  ['integration enforces irreversible trash through production purge', integration.includes("'../../src/sessionLifecycle.ts'") && integration.includes('purgeTrashSessions') && integration.includes('trash remains irreversible before and after production purge') && integration.includes('RESTORE_NOT_SUPPORTED')],
];
for (const [name, ok] of behavioralChecks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}

const sessionAction = worker.match(/async function sessionAction[\s\S]*?\n}/)?.[0] || '';
const executeIndex = sessionAction.indexOf('service.execute(admin, sessionId, action, now())');
const broadcastIndex = sessionAction.indexOf('await broadcast');
const broadcastSafe = executeIndex >= 0 && broadcastIndex > executeIndex;
console.log(`${broadcastSafe ? 'PASS' : 'FAIL'} failed writes cannot broadcast session:updated`);
if (!broadcastSafe) failed += 1;

if (failed) {
  console.error(`${failed} session transition boundary check(s) failed`);
  process.exit(1);
}
console.log('session transition boundary checks passed');