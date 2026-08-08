import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const m12 = readFileSync(new URL('../../migrations/0012_enforce_operator_policy_invariant.sql', import.meta.url), 'utf8');
const m13 = readFileSync(new URL('../../migrations/0013_structured_runtime_state.sql', import.meta.url), 'utf8');

function db() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE admins(id TEXT PRIMARY KEY,role TEXT NOT NULL);
    CREATE TABLE settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE sessions(id TEXT PRIMARY KEY,purged_at TEXT);
    CREATE TABLE admin_sessions(id TEXT PRIMARY KEY,admin_id TEXT NOT NULL,revoked_at TEXT,FOREIGN KEY(admin_id) REFERENCES admins(id));
  `);
  return db;
}

test('0013 moves dynamic settings state into typed tables and deletes legacy keys', () => {
  const x = db();
  x.exec(`INSERT INTO admins(id,role) VALUES('op','OPERATOR'),('root','SUPER_ADMIN');
    INSERT INTO sessions(id,purged_at) VALUES('s1',NULL);
    INSERT INTO admin_sessions(id,admin_id,revoked_at) VALUES('as1','root',NULL);
    INSERT INTO settings(key,value_json,updated_at) VALUES
      ('operator_policy:op','{"canCreateInvites":false,"canUseStaffChat":true,"canUploadImages":false}','2026-01-01'),
      ('operator_presentation:op','{"welcomeText":"hi","qrAccentColor":"#112233"}','2026-01-01'),
      ('session_client_meta:s1','{"deviceLabel":"安卓设备","approximateLocation":"中国","capturedAt":"2026-01-02","ipAddress":"1.2.3.4"}','2026-01-02'),
      ('admin_active_session:root','as1','2026-01-03'),
      ('admin_session_meta:as1','{"deviceLabel":"Windows 电脑","approximateLocation":"中国","capturedAt":"2026-01-03"}','2026-01-03');
  `);
  x.exec(m12);
  x.exec(m13);
  const migratedPolicy = x.prepare('SELECT can_create_invites,can_use_staff_chat,can_upload_images FROM operator_policies WHERE admin_id=?').get('op');
  assert.equal(migratedPolicy.can_create_invites, 0);
  assert.equal(migratedPolicy.can_use_staff_chat, 1);
  assert.equal(migratedPolicy.can_upload_images, 0);
  assert.equal(x.prepare('SELECT welcome_text FROM operator_presentations WHERE admin_id=?').get('op').welcome_text, 'hi');
  assert.equal(x.prepare('SELECT ip_address FROM session_client_metadata WHERE session_id=?').get('s1').ip_address, '1.2.3.4');
  assert.equal(x.prepare('SELECT session_id FROM admin_active_sessions WHERE admin_id=?').get('root').session_id, 'as1');
  assert.equal(x.prepare("SELECT COUNT(*) n FROM settings WHERE key LIKE 'operator_policy:%' OR key LIKE 'operator_presentation:%' OR key LIKE 'session_client_meta:%' OR key LIKE 'admin_active_session:%' OR key LIKE 'admin_session_meta:%'").get().n, 0);
  x.close();
});

test('typed policy remains fail closed and promotion replaces stale state', () => {
  const x = db();
  x.exec(`INSERT INTO admins(id,role) VALUES('future','SUPER_ADMIN'); INSERT INTO settings(key,value_json,updated_at) VALUES('operator_policy:future','not-json','2026-01-01');`);
  x.exec(m12);
  x.exec(m13);
  x.prepare('UPDATE admins SET role=? WHERE id=?').run('OPERATOR','future');
  const promotedPolicy = x.prepare('SELECT can_create_invites,can_use_staff_chat,can_upload_images FROM operator_policies WHERE admin_id=?').get('future');
  assert.equal(promotedPolicy.can_create_invites, 1);
  assert.equal(promotedPolicy.can_use_staff_chat, 1);
  assert.equal(promotedPolicy.can_upload_images, 1);
  assert.throws(() => x.prepare('DELETE FROM operator_policies WHERE admin_id=?').run('future'), /operator_policy_required/);
  x.close();
});
