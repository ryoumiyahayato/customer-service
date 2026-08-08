import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/check-high-risk-business-closures.mjs';
let source = readFileSync(path, 'utf8');

function replace(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, got ${count}`);
  source = source.replace(before, after);
}

replace(`assert.match(operatorPolicy, /operator_policy:/);
assert.match(operatorPolicy, /DENY_OPERATOR_POLICY/);
assert.match(operatorPolicy, /if \\(!valueJson\\) return \\{ \\.\\.\\.DENY_OPERATOR_POLICY \\}/);
assert.match(operatorPolicy, /catch \\{[\\s\\S]*?DENY_OPERATOR_POLICY/);`, `assert.match(operatorPolicy, /FROM operator_policies WHERE admin_id=\\?/);
assert.match(operatorPolicy, /DENY_OPERATOR_POLICY/);
assert.match(operatorPolicy, /if \\(!row\\) return \\{ \\.\\.\\.DENY_OPERATOR_POLICY \\}/);
assert.doesNotMatch(operatorPolicy, /operator_policy:/);`, 'typed operator policy assertions');

replace(`assert.match(presentationWrapper, /operatorPresentationKey/);`, `assert.match(presentationWrapper, /readOperatorPresentation/);
assert.doesNotMatch(presentationWrapper, /operator_presentation:/);`, 'typed presentation assertion');

source = source.replace(`const policyMigration = read('migrations/0012_enforce_operator_policy_invariant.sql');`, `const policyMigration = read('migrations/0012_enforce_operator_policy_invariant.sql');
const structuredStateMigration = read('migrations/0013_structured_runtime_state.sql');`);
source = source.replace(`assert.match(policyMigration, /operator_policy_required/);`, `assert.match(policyMigration, /operator_policy_required/);
assert.match(structuredStateMigration, /CREATE TABLE IF NOT EXISTS operator_policies/);
assert.match(structuredStateMigration, /CREATE TABLE IF NOT EXISTS operator_presentations/);
assert.match(structuredStateMigration, /CREATE TABLE IF NOT EXISTS session_client_metadata/);
assert.match(structuredStateMigration, /CREATE TABLE IF NOT EXISTS admin_session_metadata/);
assert.match(structuredStateMigration, /CREATE TABLE IF NOT EXISTS admin_active_sessions/);`);

writeFileSync(path, source);
console.log('updated high-risk closure assertions for structured runtime state');
