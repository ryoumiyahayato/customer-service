import { runGenericLifecycleDryRun } from '../dist/lifecycleRunner.js';

try {
  const result = await runGenericLifecycleDryRun();
  if (!result.readOnly || result.writesExecuted || result.sqlType !== 'SELECT') {
    throw new Error('Lifecycle dry-run must remain read-only.');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Lifecycle dry-run failed.');
  process.exitCode = 1;
}
