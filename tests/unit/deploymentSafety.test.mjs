import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  extractPendingMigrationNames,
  migrationApplyArgs,
  migrationListArgs,
  workersBuildBranchDecision,
  wranglerInvocation,
} from '../../scripts/deployment-safety-lib.mjs';

test('Workers Builds require branch metadata and separate preview from production intent', () => {
  assert.deepEqual(workersBuildBranchDecision({}), {
    workersBuild: false,
    allowed: true,
    branch: '',
    reason: 'not_workers_build',
    production: false,
  });
  assert.deepEqual(workersBuildBranchDecision({ WORKERS_CI: '1' }), {
    workersBuild: true,
    allowed: false,
    branch: '',
    reason: 'missing_branch',
    production: false,
  });
  assert.deepEqual(workersBuildBranchDecision({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feature/test' }), {
    workersBuild: true,
    allowed: true,
    branch: 'feature/test',
    reason: 'preview_branch',
    production: false,
  });
  assert.deepEqual(workersBuildBranchDecision({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' }), {
    workersBuild: true,
    allowed: true,
    branch: 'main',
    reason: 'production_branch',
    production: true,
  });
});

test('Cloudflare build gate permits version builds but keeps migration verification main-only', async () => {
  const gate = await readFile(new URL('../../scripts/guard-cloudflare-workers-build.mjs', import.meta.url), 'utf8');
  assert.match(gate, /if \(!decision\.production\)/);
  assert.match(gate, /may build\/upload a version; production promotion is not authorized/);
  assert.ok(gate.indexOf('if (!decision.production)') < gate.indexOf('migrationListArgs()'));
  assert.match(gate, /Pending remote D1 migrations block automatic production deployment/);
});

test('wrangler migration invocation never drops the d1 subcommand', () => {
  assert.deepEqual(
    wranglerInvocation('/repo/node_modules/.bin/wrangler', 'npx', migrationListArgs()),
    {
      command: '/repo/node_modules/.bin/wrangler',
      args: ['d1', 'migrations', 'list', 'customer_chat_db', '--remote'],
    },
  );
  assert.deepEqual(
    wranglerInvocation('', 'npx', migrationApplyArgs()),
    {
      command: 'npx',
      args: ['wrangler', 'd1', 'migrations', 'apply', 'customer_chat_db', '--remote'],
    },
  );
});

test('pending migration parser recognizes migration filenames and ignores no-op output', () => {
  assert.deepEqual(extractPendingMigrationNames('No migrations to apply!'), []);
  assert.deepEqual(
    extractPendingMigrationNames('│ Migration Name │\n│ 0012_enforce_operator_policy_invariant.sql │\n│ 0013_next.sql │'),
    ['0012_enforce_operator_policy_invariant.sql', '0013_next.sql'],
  );
});

test('production deploy aliases use the guarded deploy while deploy:cloudflare preserves explicit opt-in', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  for (const name of ['deploy', 'cf:deploy', 'deploy:safe']) {
    assert.equal(pkg.scripts[name], 'node scripts/deploy-cloudflare-safe.mjs');
  }
  assert.equal(pkg.scripts['deploy:cloudflare'], 'node scripts/deploy-cloudflare.mjs');
  assert.match(pkg.scripts.build, /guard-cloudflare-workers-build\.mjs/);

  const wrapper = await readFile(new URL('../../scripts/deploy-cloudflare.mjs', import.meta.url), 'utf8');
  assert.match(wrapper, /deployRequested/);
  assert.match(wrapper, /if \(deployRequested\)/);
  assert.ok(wrapper.indexOf('if (deployRequested)') < wrapper.indexOf("['run', 'build']"));
  assert.match(wrapper, /No production deployment was started/);
  assert.match(wrapper, /deploy-cloudflare-safe\.mjs/);
  assert.doesNotMatch(wrapper, /['"]wrangler['"]\s*,\s*['"]deploy['"]/);
  assert.doesNotMatch(wrapper, /npx\s+wrangler\s+deploy/);
});
