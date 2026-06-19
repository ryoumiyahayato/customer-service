const { createServer } = require('http');
const next = require('next');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev }); const handle = app.getRequestHandler();
const dataDir=process.env.DATA_DIR||path.join(process.cwd(),'data'); fs.mkdirSync(dataDir,{recursive:true});
const db=new Database(process.env.DATABASE_PATH||path.join(dataDir,'support.sqlite')); db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
const now=()=>new Date().toISOString(); const id=p=>`${p}_${crypto.randomBytes(12).toString('hex')}`;
function init(){db.exec(`CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','OPERATOR')), must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, visitor_key TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, assigned_operator_id TEXT, last_operator_id TEXT, status TEXT NOT NULL CHECK(status IN ('PENDING','OPEN','CLOSED','ARCHIVED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sender_type TEXT NOT NULL CHECK(sender_type IN ('VISITOR','OPERATOR')), sender_id TEXT NOT NULL, content TEXT, message_type TEXT NOT NULL CHECK(message_type IN ('text','image')), image_path TEXT, status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','read')), created_at TEXT NOT NULL, read_at TEXT, is_read INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS system_logs (id TEXT PRIMARY KEY, level TEXT NOT NULL, event TEXT NOT NULL, actor_id TEXT, message TEXT NOT NULL, created_at TEXT NOT NULL);`); if(!db.prepare('SELECT id FROM admins WHERE username=?').get('admin')){const p=crypto.randomBytes(9).toString('base64url'),t=now();db.prepare('INSERT INTO admins VALUES (?,?,?,?,?,?,?)').run(id('admin'),'admin',bcrypt.hashSync(p,10),'SUPER_ADMIN',1,t,t); console.log(`Default admin created: username=admin password=${p}`)}}
app.prepare().then(()=>{init(); const server=createServer((req,res)=>handle(req,res)); const io=new Server(server,{path:'/api/socket',cors:{origin:'*'}}); global.io=io;
io.on('connection',socket=>{socket.on('visitor:join',({visitorId,sessionId})=>{socket.join(`visitor:${visitorId}`); if(sessionId) socket.join(`session:${sessionId}`);}); socket.on('admin:join',()=>socket.join('admins')); socket.on('session:join',sid=>socket.join(`session:${sid}`)); socket.on('message:read',sid=>{const t=now(); db.prepare('UPDATE messages SET is_read=1,status=?,read_at=COALESCE(read_at,?) WHERE session_id=?').run('read',t,sid); io.to(`session:${sid}`).emit('messages:read',{sessionId:sid,readAt:t});});});
const port=process.env.PORT||3000; server.listen(port,()=>console.log(`Support system ready on http://localhost:${port}`));});
