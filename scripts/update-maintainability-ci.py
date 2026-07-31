#!/usr/bin/env python3
from pathlib import Path

root = Path.cwd()

static_path = root / 'scripts/check-session-lifecycle.mjs'
static = static_path.read_text(encoding='utf-8-sig')
old = """  check('sessionAction close sets status ARCHIVED', worker.includes(\"action === 'close'\") && worker.includes(\"status='ARCHIVED'\"));
  check('sessionAction close/archive binds values in SQL placeholder order', worker.includes('.bind(t, t, admin.id, t, sessionId).run()'));
  check('sessionAction delete checks purged_at', worker.includes(\"action === 'delete'\") && worker.includes('purged_at IS NULL'));
  check('sessionAction restore checks purged_at', worker.includes(\"action === 'restore'\") && worker.includes('purged_at IS NULL'));"""
new = """  const sessionRepository = readFile('src/repositories/sessionRepository.ts');
  const sessionService = readFile('src/services/sessionService.ts');
  check('session service owns archive actions', sessionService.includes(\"action === 'close' || action === 'archive'\") && sessionService.includes('this.sessions.archive'));
  check('session repository writes ARCHIVED with ordered bindings', sessionRepository.includes(\"status='ARCHIVED'\") && sessionRepository.includes('.bind(timestamp, timestamp, actorId, timestamp, sessionId).run()'));
  check('session repository delete checks purged_at', sessionRepository.includes('moveToTrash') && sessionRepository.includes('purged_at IS NULL'));
  check('session repository restore checks purged_at', sessionRepository.includes('restore(sessionId') && sessionRepository.includes('deleted_at IS NOT NULL AND purged_at IS NULL'));
  check('runtime worker delegates session actions to SessionService', worker.includes('new SessionService(') && worker.includes('service.execute(admin, sessionId, action, now())'));
  check('runtime worker contains no legacy unarchive write to CLOSED', !worker.includes(\"status='CLOSED'\"));"""
if old not in static:
    raise RuntimeError('static session action contract block missing')
static_path.write_text(static.replace(old, new, 1), encoding='utf-8')

workflow_path = root / '.github/workflows/productization-validation.yml'
workflow = workflow_path.read_text(encoding='utf-8-sig')
workflow = workflow.replace(
    '      - name: Root session lifecycle static contracts\n        run: npm run check-session-lifecycle-static',
    '      - name: Static Contract Checks\n        run: npm run check:static-contracts',
)
workflow = workflow.replace(
    '      - name: Root unit behavior tests\n        run: npm run test:unit',
    '      - name: Unit Tests\n        run: npm run test:unit\n\n      - name: SQLite Integration Tests\n        run: npm run test:integration',
)
workflow_path.write_text(workflow, encoding='utf-8')

print('maintainability CI and static contracts updated')
