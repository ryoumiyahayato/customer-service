import { runGenericLifecycleDryRun } from '../dist/lifecycleRunner.js';

try {
  const result = await runGenericLifecycleDryRun();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Lifecycle dry-run failed.');
  process.exitCode = 1;
}
