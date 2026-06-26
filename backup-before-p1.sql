PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_init.sql','2026-06-26 04:58:46');
CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','OPERATOR')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  is_disabled INTEGER NOT NULL DEFAULT 0,
  disabled_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO "admins" ("id","username","display_name","password_hash","role","must_change_password","is_disabled","disabled_at","last_seen_at","created_at","updated_at") VALUES('admin_5cdf17d6b8cb41669778e919','ryouma','ryouma','pbkdf2:100000:tAFKZWvZZDHCy64HOVHDKg==:/iTtUPwpyP38LyipnMFL66XkOzZTCOnGm4yjPXTQS/I=','SUPER_ADMIN',0,0,NULL,'2026-06-26T10:00:24.859Z','2026-06-26T06:15:28.809Z','2026-06-26T06:15:28.809Z');
INSERT INTO "admins" ("id","username","display_name","password_hash","role","must_change_password","is_disabled","disabled_at","last_seen_at","created_at","updated_at") VALUES('admin_226b461a849c4d1c82bde3af','admin01','admin01','pbkdf2:100000:YkHWvh+akwsJZjiGz993Kg==:RbdI969UgIxF7HkK0RYu3X81MlnZuHEX1M78YftxX9I=','OPERATOR',0,0,NULL,'2026-06-26T11:32:53.203Z','2026-06-26T08:28:55.397Z','2026-06-26T08:28:55.397Z');
CREATE TABLE visitor_accounts (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO "visitor_accounts" ("id","username","password_hash","display_name","last_login_at","created_at","updated_at") VALUES('acct_0991cbf812f94b9c818c7d74','114514homo','pbkdf2:100000:OctWJzWViHpLMDX7FJdoKQ==:o3a/MNi9N8srw0jFMTqTPGofwHGk7nAo8c5DuZBOLm4=','123456789','2026-06-26T08:58:40.310Z','2026-06-26T08:43:47.662Z','2026-06-26T08:58:40.310Z');
INSERT INTO "visitor_accounts" ("id","username","password_hash","display_name","last_login_at","created_at","updated_at") VALUES('acct_4d1a81d3b9b64168b50006e1','lingyun','pbkdf2:100000:2CTHLNRjkBebIL/KkFNpKg==:KH88hjSx6J7AxfxZkKnCS9kSDooJSjwuicQhaITUXbk=','灵芸','2026-06-26T09:50:03.070Z','2026-06-26T09:49:50.837Z','2026-06-26T09:50:03.070Z');
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  visitor_key TEXT UNIQUE NOT NULL,
  account_id TEXT REFERENCES visitor_accounts(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO "users" ("id","visitor_key","account_id","display_name","last_seen_at","created_at","updated_at") VALUES('user_d9d38acbff4146ab970fa01b','visitor_c2ba1683e54c4d348cabdcda',NULL,'璁垮 abdcda','2026-06-26T11:32:53.116Z','2026-06-26T08:23:39.233Z','2026-06-26T11:32:53.116Z');
INSERT INTO "users" ("id","visitor_key","account_id","display_name","last_seen_at","created_at","updated_at") VALUES('user_5299b998655942a7a4507bbb','visitor_b2c6f83570b54650a5ab1d7b',NULL,'璁垮 ab1d7b','2026-06-26T08:47:29.397Z','2026-06-26T08:43:48.842Z','2026-06-26T08:47:29.397Z');
INSERT INTO "users" ("id","visitor_key","account_id","display_name","last_seen_at","created_at","updated_at") VALUES('user_75570b384d794e84b1af2225','acct_acct_0991cbf812f94b9c818c7d74','acct_0991cbf812f94b9c818c7d74','123456789','2026-06-26T08:59:16.987Z','2026-06-26T08:58:41.810Z','2026-06-26T08:59:16.987Z');
INSERT INTO "users" ("id","visitor_key","account_id","display_name","last_seen_at","created_at","updated_at") VALUES('user_689f368d536b4e81b3c21686','acct_acct_4d1a81d3b9b64168b50006e1','acct_4d1a81d3b9b64168b50006e1','灵芸','2026-06-26T09:47:10.627Z','2026-06-26T09:47:08.225Z','2026-06-26T09:49:51.051Z');
INSERT INTO "users" ("id","visitor_key","account_id","display_name","last_seen_at","created_at","updated_at") VALUES('user_e8caa0171e654bffa9f7188c','visitor_mquqyqo0_e243ndpz',NULL,'璁垮 43ndpz','2026-06-26T09:50:40.417Z','2026-06-26T09:49:52.756Z','2026-06-26T09:50:40.417Z');
INSERT INTO "users" ("id","visitor_key","account_id","display_name","last_seen_at","created_at","updated_at") VALUES('user_46d93970491045a289da8aea','visitor_3b29e152d32c4cdda25ee10b',NULL,'璁垮 5ee10b','2026-06-26T10:00:46.471Z','2026-06-26T10:00:46.471Z','2026-06-26T10:00:46.471Z');
INSERT INTO "users" ("id","visitor_key","account_id","display_name","last_seen_at","created_at","updated_at") VALUES('user_e700ccff6c5e4a309e702b41','visitor_mquzuxkp_gjhu8imf',NULL,'璁垮 hu8imf','2026-06-26T13:56:07.158Z','2026-06-26T13:56:07.158Z','2026-06-26T13:56:07.158Z');
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  assigned_operator_id TEXT REFERENCES admins(id),
  last_operator_id TEXT REFERENCES admins(id),
  status TEXT NOT NULL CHECK(status IN ('PENDING','OPEN','CLOSED','ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT REFERENCES admins(id)
);
INSERT INTO "sessions" ("id","user_id","assigned_operator_id","last_operator_id","status","created_at","updated_at","deleted_at","deleted_by") VALUES('sess_fab7e6522daf4e048607364d','user_d9d38acbff4146ab970fa01b',NULL,NULL,'PENDING','2026-06-26T08:23:48.673Z','2026-06-26T08:24:55.178Z',NULL,NULL);
INSERT INTO "sessions" ("id","user_id","assigned_operator_id","last_operator_id","status","created_at","updated_at","deleted_at","deleted_by") VALUES('sess_ef2648c2927b497dbffff1bc','user_75570b384d794e84b1af2225',NULL,NULL,'PENDING','2026-06-26T08:59:14.068Z','2026-06-26T08:59:17.451Z',NULL,NULL);
INSERT INTO "sessions" ("id","user_id","assigned_operator_id","last_operator_id","status","created_at","updated_at","deleted_at","deleted_by") VALUES('sess_566ba6f9a57040d7aee7bb6e','user_689f368d536b4e81b3c21686',NULL,NULL,'PENDING','2026-06-26T09:47:11.208Z','2026-06-26T09:57:21.353Z',NULL,NULL);
INSERT INTO "sessions" ("id","user_id","assigned_operator_id","last_operator_id","status","created_at","updated_at","deleted_at","deleted_by") VALUES('sess_227bb5b058cd4289a023ed9f','user_e8caa0171e654bffa9f7188c',NULL,NULL,'PENDING','2026-06-26T09:50:33.697Z','2026-06-26T09:50:41.186Z',NULL,NULL);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK(sender_type IN ('VISITOR','OPERATOR')),
  sender_id TEXT NOT NULL,
  content TEXT,
  message_type TEXT NOT NULL CHECK(message_type IN ('text','image')),
  image_path TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','read','recalled')),
  created_at TEXT NOT NULL,
  read_at TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  quote_message_id TEXT,
  recalled_at TEXT,
  image_purged_at TEXT
);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_52221a42cd054a5f8bfc5e83','sess_fab7e6522daf4e048607364d','VISITOR','visitor_c2ba1683e54c4d348cabdcda','666','text',NULL,'read','2026-06-26T08:23:48.918Z','2026-06-26T08:23:56.591Z',1,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_5fb5e3d958c347158edde661','sess_fab7e6522daf4e048607364d','VISITOR','visitor_c2ba1683e54c4d348cabdcda','牛皮啊','text',NULL,'read','2026-06-26T08:24:01.655Z','2026-06-26T08:24:03.172Z',1,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_c4b01fc1c85c48cfa09408cb','sess_fab7e6522daf4e048607364d','VISITOR','visitor_c2ba1683e54c4d348cabdcda','wcao','text',NULL,'read','2026-06-26T08:24:06.235Z','2026-06-26T08:24:07.786Z',1,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_1e2d496134dc445cb8dca1e5','sess_fab7e6522daf4e048607364d','OPERATOR','admin_5cdf17d6b8cb41669778e919','爆赞','text',NULL,'read','2026-06-26T08:24:21.252Z','2026-06-26T09:16:13.772Z',1,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_3a8413e48221466e8c58dc07','sess_fab7e6522daf4e048607364d','OPERATOR','admin_5cdf17d6b8cb41669778e919','还有这种东西的哦','text',NULL,'read','2026-06-26T08:24:32.602Z','2026-06-26T09:16:13.772Z',1,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_2515d8d4514149788e2c763b','sess_fab7e6522daf4e048607364d','VISITOR','visitor_c2ba1683e54c4d348cabdcda','我补刀啊','text',NULL,'read','2026-06-26T08:24:37.316Z','2026-06-26T08:24:38.851Z',1,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_148ff5f598824afd90fc0b7c','sess_fab7e6522daf4e048607364d','VISITOR','visitor_c2ba1683e54c4d348cabdcda','但是还有点延迟是真的','text',NULL,'read','2026-06-26T08:24:43.969Z','2026-06-26T08:24:45.476Z',1,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_0416282e136c48aa83432752','sess_fab7e6522daf4e048607364d','OPERATOR','admin_5cdf17d6b8cb41669778e919','这个没办法','text',NULL,'read','2026-06-26T08:24:53.518Z','2026-06-26T09:16:13.772Z',1,'msg_148ff5f598824afd90fc0b7c',NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_559a4000f44c476e890b03e3','sess_fab7e6522daf4e048607364d','OPERATOR','admin_5cdf17d6b8cb41669778e919','这个没办法','text',NULL,'read','2026-06-26T08:24:55.178Z','2026-06-26T09:16:13.772Z',1,'msg_148ff5f598824afd90fc0b7c',NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_67cbaaa0ba264fb7b3b00ee0','sess_ef2648c2927b497dbffff1bc','VISITOR','acct_acct_0991cbf812f94b9c818c7d74','q','text',NULL,'sent','2026-06-26T08:59:14.387Z',NULL,0,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_d205d868bf734ff9b7372c37','sess_ef2648c2927b497dbffff1bc','VISITOR','acct_acct_0991cbf812f94b9c818c7d74','111','text',NULL,'sent','2026-06-26T08:59:17.451Z',NULL,0,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_f20802d0bcf14b60a4b92f20','sess_566ba6f9a57040d7aee7bb6e','VISITOR','visitor_mquqyqo0_e243ndpz','111','text',NULL,'read','2026-06-26T09:47:11.594Z','2026-06-26T09:55:13.036Z',1,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_3e648bda864b4dfd8a6fb821','sess_227bb5b058cd4289a023ed9f','VISITOR','visitor_mquqyqo0_e243ndpz','111','text',NULL,'sent','2026-06-26T09:50:34.094Z',NULL,0,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_b1f856bac0db400eacb57403','sess_227bb5b058cd4289a023ed9f','VISITOR','visitor_mquqyqo0_e243ndpz','您好','text',NULL,'sent','2026-06-26T09:50:41.186Z',NULL,0,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_4cf843543cd74f69ac885161','sess_566ba6f9a57040d7aee7bb6e','OPERATOR','admin_5cdf17d6b8cb41669778e919','何意味','text',NULL,'sent','2026-06-26T09:55:17.632Z',NULL,0,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_46bf3f0d18ac4236b631c8c5','sess_566ba6f9a57040d7aee7bb6e','OPERATOR','admin_5cdf17d6b8cb41669778e919','何意味','text',NULL,'sent','2026-06-26T09:55:19.499Z',NULL,0,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_f2a51ce3455243e89bc10c4f','sess_566ba6f9a57040d7aee7bb6e','OPERATOR','admin_5cdf17d6b8cb41669778e919','66','text',NULL,'sent','2026-06-26T09:57:19.299Z',NULL,0,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_aa4b5583c71c4310b29ac625','sess_566ba6f9a57040d7aee7bb6e','OPERATOR','admin_5cdf17d6b8cb41669778e919','66','text',NULL,'sent','2026-06-26T09:57:20.527Z',NULL,0,NULL,NULL,NULL);
INSERT INTO "messages" ("id","session_id","sender_type","sender_id","content","message_type","image_path","status","created_at","read_at","is_read","quote_message_id","recalled_at","image_purged_at") VALUES('msg_f3bc75212b0f4784be5245d5','sess_566ba6f9a57040d7aee7bb6e','OPERATOR','admin_5cdf17d6b8cb41669778e919','66','text',NULL,'sent','2026-06-26T09:57:21.353Z',NULL,0,NULL,NULL,NULL);
CREATE TABLE staff_messages (
  id TEXT PRIMARY KEY,
  sender_admin_id TEXT NOT NULL REFERENCES admins(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO "staff_messages" ("id","sender_admin_id","content","created_at") VALUES('staffmsg_96be486b4e854ee5932d46a9','admin_226b461a849c4d1c82bde3af','111','2026-06-26T08:31:00.256Z');
INSERT INTO "staff_messages" ("id","sender_admin_id","content","created_at") VALUES('staffmsg_3a5c6bf4410746dcb0324451','admin_5cdf17d6b8cb41669778e919','何意味','2026-06-26T08:31:08.677Z');
INSERT INTO "staff_messages" ("id","sender_admin_id","content","created_at") VALUES('staffmsg_aa5df35cfa0b47d4b04499a5','admin_5cdf17d6b8cb41669778e919','有什么事情吗','2026-06-26T08:31:16.854Z');
INSERT INTO "staff_messages" ("id","sender_admin_id","content","created_at") VALUES('staffmsg_d1940ee717ea4b278673d47a','admin_5cdf17d6b8cb41669778e919','有什么事情吗','2026-06-26T08:31:18.152Z');
CREATE TABLE system_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  actor_id TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('13.193.215.75:/api/messages',4,1782462300000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('103.77.192.153:/api/admins',2,1782462600000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('13.193.215.75:/api/auth/logout',1,1782462660000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('13.193.215.75:/api/login',1,1782462660000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('13.193.215.75:/api/staff-chat',1,1782462660000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('103.77.192.153:/api/staff-chat',3,1782462720000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('240e:410:10:49c:4cea:a3ff:feea:3957:/api/account/register',1,1782463440000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('240e:410:10:49c:4cea:a3ff:feea:3957:/api/login',1,1782463620000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('240e:410:10:49c:4cea:a3ff:feea:3957:/api/visitor',1,1782463620000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('240e:410:10:49c:f1ea:7cfd:bab5:3c30:/api/login',1,1782464340000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('240e:410:10:49c:f1ea:7cfd:bab5:3c30:/api/visitor',1,1782464340000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('240e:410:10:49c:f1ea:7cfd:bab5:3c30:/api/messages',2,1782464400000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('47.129.202.162:/api/account/register',4,1782467400000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('47.129.202.162:/api/login',1,1782467460000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('47.129.202.162:/api/visitor',3,1782467460000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('47.129.202.162:/api/messages',2,1782467460000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('103.77.192.153:/api/messages',3,1782467880000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('103.77.192.153:/api/login',1,1782468060000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('103.77.192.153:/api/visitor',1,1782468060000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('13.193.215.75:/api/visitor',1,1782473580000);
INSERT INTO "rate_limits" ("key","count","reset_at") VALUES('36.37.198.152:/api/visitor',1,1782482220000);
CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_101b40a2dfc94c06ab6c5f2e','admin_5cdf17d6b8cb41669778e919','5e8b5fa715d37bae2fe1c9496f050eb071298f65b96362302968e278ad8c3afb','2026-06-26T06:24:37.422Z','2026-07-03T06:24:37.422Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_c933b01bbb2e486591427419','admin_5cdf17d6b8cb41669778e919','3f894eed020aec8aa19814bba25335b4f8a6dcdd9486ce14ff75c88fb7928520','2026-06-26T08:23:24.052Z','2026-07-03T08:23:24.052Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_d09756eb622e4a26a742a63d','admin_226b461a849c4d1c82bde3af','503fdce146e0313a2b96ba996368d9464176d6b3c18b55d9aeb815478e2a002b','2026-06-26T08:29:24.129Z','2026-07-03T08:29:24.129Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_207e4eb61e3348b49d20123d','admin_5cdf17d6b8cb41669778e919','1fb0ba9e1ce524c092215a3d3f52c93c56310ea418146f9786393d168cbb9acf','2026-06-26T08:29:49.497Z','2026-07-03T08:29:49.497Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_f0afa90510384350aa0cae9f','admin_226b461a849c4d1c82bde3af','e8b3eaefaa1e4931a9ab9e9a4a8ff6ccb608203055cf2245e506f9a862205b48','2026-06-26T08:30:47.055Z','2026-07-03T08:30:47.055Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_60ee8e0c42964e21aebb084d','admin_226b461a849c4d1c82bde3af','c715aa83af09c6c98a8e34e83bbe72aa06b6c257a7b4bd5fe64362b6fddf4d0f','2026-06-26T08:31:45.318Z','2026-07-03T08:31:45.318Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_f96d542da26249c586f3a72d','admin_5cdf17d6b8cb41669778e919','bfd4b18e3fdfd3939876828614f87d6587efe85473e1ad5503d2a310d51535fb','2026-06-26T08:34:33.522Z','2026-07-03T08:34:33.522Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_8a9521c506d948478c86047d','admin_5cdf17d6b8cb41669778e919','f6b80c42adc708e2ea8e48aebd30e395f5332f2134b1fbcddb9ad4472553c809','2026-06-26T08:37:08.122Z','2026-07-03T08:37:08.122Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_432bc01aec23401f975125e7','admin_5cdf17d6b8cb41669778e919','261f3b3f06d84780e5c4cfef6c096082b1de8de89685e49dbf76d5353ebca657','2026-06-26T08:37:09.292Z','2026-07-03T08:37:09.292Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_927e61f98f7a473f9324522b','admin_5cdf17d6b8cb41669778e919','b5ef9da6b3af0982728cb8a6e3b09691f85fa49c3635df74124643587a67c8ee','2026-06-26T08:38:15.121Z','2026-07-03T08:38:15.121Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_a76a7640a4a74fd08af1337d','admin_5cdf17d6b8cb41669778e919','f781dc54486b8b28a7ade609b1c20d375f92b64d7da7435cf45c2f29a4fd24a2','2026-06-26T08:46:47.176Z','2026-07-03T08:46:47.176Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_5ae522f795fc49e7b450d0ee','admin_5cdf17d6b8cb41669778e919','d249f4197f04877044198e4272af6e29c0ea857abc3e54645ef6b96dc6b9efa4','2026-06-26T09:49:28.686Z','2026-07-03T09:49:28.686Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_393f4e7e904348deb3202937','admin_5cdf17d6b8cb41669778e919','70cac25865d91e4f66e1ba9e12d5acfaf33fa20243c2ffdad86257f13c1b5876','2026-06-26T09:49:29.168Z','2026-07-03T09:49:29.168Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_7cacca1665754d3f8640995f','admin_5cdf17d6b8cb41669778e919','5f505ed16a7f91934ab0767219578c845188d2420d26ec8050cb4583ef583877','2026-06-26T09:57:09.986Z','2026-07-03T09:57:09.986Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_30fdb3cfeda347579ff6803c','admin_5cdf17d6b8cb41669778e919','fee25b3db194db1120205b1c06d45e3837fd620b549eb17bc38be1ea50e93ee7','2026-06-26T09:57:11.096Z','2026-07-03T09:57:11.096Z',NULL);
INSERT INTO "admin_sessions" ("id","admin_id","token_hash","created_at","expires_at","revoked_at") VALUES('asess_8c1278f01aea43d5becad472','admin_5cdf17d6b8cb41669778e919','8f7d4571ddcca48bcebc65eb22f2966021560790b0c682289f5b5d3456694f33','2026-06-26T10:00:21.389Z','2026-07-03T10:00:21.389Z',NULL);
CREATE TABLE visitor_sessions (
  id TEXT PRIMARY KEY,
  visitor_account_id TEXT REFERENCES visitor_accounts(id) ON DELETE CASCADE,
  visitor_key TEXT,
  token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
INSERT INTO "visitor_sessions" ("id","visitor_account_id","visitor_key","token_hash","created_at","expires_at","revoked_at") VALUES('vsess_308d18aae24944f1a1552333','acct_0991cbf812f94b9c818c7d74',NULL,'cb2bdcba9751a5bc9c51cb9a1349b68f8268822954f4cd85808b1dc2ef6738f9','2026-06-26T08:43:47.826Z','2026-07-03T08:43:47.826Z',NULL);
INSERT INTO "visitor_sessions" ("id","visitor_account_id","visitor_key","token_hash","created_at","expires_at","revoked_at") VALUES('vsess_1a8f4bdbc85d4435973feec4','acct_0991cbf812f94b9c818c7d74',NULL,'5fdbd096e2c5e7b102fa874904bd79697387d066f16283879f01c4575452bf5f','2026-06-26T08:44:44.590Z','2026-07-03T08:44:44.590Z',NULL);
INSERT INTO "visitor_sessions" ("id","visitor_account_id","visitor_key","token_hash","created_at","expires_at","revoked_at") VALUES('vsess_5cd7d4320d6744c9b5ea9370','acct_0991cbf812f94b9c818c7d74',NULL,'a4ac1b2ef17c14acfb9db30ba223b35b7152684b3e7cc1d50dfc1427a1dc8724','2026-06-26T08:46:13.522Z','2026-07-03T08:46:13.522Z',NULL);
INSERT INTO "visitor_sessions" ("id","visitor_account_id","visitor_key","token_hash","created_at","expires_at","revoked_at") VALUES('vsess_e6a0e96a1faf4d85982c78ac','acct_0991cbf812f94b9c818c7d74',NULL,'aa0e31237a27b76ad18136ca5d5e7a3782a6924d46a6211db57b3f7f605d7dd0','2026-06-26T08:47:28.112Z','2026-07-03T08:47:28.112Z',NULL);
INSERT INTO "visitor_sessions" ("id","visitor_account_id","visitor_key","token_hash","created_at","expires_at","revoked_at") VALUES('vsess_b52272f448e94e97b6bfc7cf','acct_0991cbf812f94b9c818c7d74',NULL,'bfa0cac3f33f1061b76093f81a43609ddca8db1e0ac74755b6472f41c02a1645','2026-06-26T08:58:40.475Z','2026-07-03T08:58:40.475Z',NULL);
INSERT INTO "visitor_sessions" ("id","visitor_account_id","visitor_key","token_hash","created_at","expires_at","revoked_at") VALUES('vsess_36d3bbc7554c4f07a3899ce3','acct_4d1a81d3b9b64168b50006e1','visitor_mquqyqo0_e243ndpz','ae2b3363c5901af9ea0a7f728e33ce8a8ae73acc1a902e449d5b6b5f2fdaa42c','2026-06-26T09:49:51.669Z','2026-07-03T09:49:51.669Z',NULL);
INSERT INTO "visitor_sessions" ("id","visitor_account_id","visitor_key","token_hash","created_at","expires_at","revoked_at") VALUES('vsess_cc57e00dbeee48d99f1e1209','acct_4d1a81d3b9b64168b50006e1',NULL,'ff7cb37d4a9f146c4602fd24dd3980868a3998e7a008dd1a068b47496ebe7a34','2026-06-26T09:50:03.270Z','2026-07-03T09:50:03.270Z',NULL);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  object_key TEXT UNIQUE NOT NULL,
  file_name TEXT,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by_type TEXT CHECK(created_by_type IN ('VISITOR','OPERATOR')),
  created_by_id TEXT
);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',1);
CREATE UNIQUE INDEX one_super_admin ON admins(role) WHERE role='SUPER_ADMIN';
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_deleted_at ON sessions(deleted_at);
CREATE INDEX idx_messages_session_created ON messages(session_id, created_at);
CREATE INDEX idx_staff_messages_created ON staff_messages(created_at);
CREATE INDEX idx_admin_sessions_token_hash ON admin_sessions(token_hash);
CREATE INDEX idx_admin_sessions_admin_id ON admin_sessions(admin_id);
CREATE INDEX idx_visitor_sessions_token_hash ON visitor_sessions(token_hash);
CREATE INDEX idx_visitor_sessions_visitor_key ON visitor_sessions(visitor_key);
CREATE INDEX idx_attachments_conversation_id ON attachments(conversation_id);
CREATE INDEX idx_attachments_created_at ON attachments(created_at);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE VIEW conversations AS
SELECT
  s.id,
  s.user_id,
  s.assigned_operator_id,
  s.last_operator_id,
  s.status,
  s.created_at,
  s.updated_at AS last_message_at,
  s.deleted_at,
  s.deleted_by
FROM sessions s;
