import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = process.cwd();
const tempDir = await mkdtemp(path.join(tmpdir(), 'chat-message-text-'));

try {
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const tscArgs = [
    'src/chatMessageTokens.ts',
    '--target', 'ES2022',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--skipLibCheck',
    '--outDir', tempDir,
  ];
  const compile = spawnSync(process.execPath, [tsc, ...tscArgs], { cwd: root, stdio: 'inherit' });

  if (compile.status !== 0) process.exit(compile.status || 1);

  const { parseChatMessageText } = await import(pathToFileURL(path.join(tempDir, 'chatMessageTokens.js')).href);
  const links = (value) => parseChatMessageText(value).filter((part) => part.type === 'link');

  assert.deepEqual(parseChatMessageText('hello world'), [{ type: 'text', text: 'hello world' }]);

  const https = links('download https://example.com/download/app.zip now');
  assert.equal(https.length, 1);
  assert.equal(https[0].href, 'https://example.com/download/app.zip');
  assert.equal(links('(https://example.com/path)').length, 1);
  assert.equal(links('"https://example.com/path"').length, 1);

  assert.equal(links('http://example.com/download/app.zip').length, 0);
  assert.equal(links('javascript:alert(1)').length, 0);
  assert.equal(links('javascript:https://example.com').length, 0);
  assert.equal(links('data:text/html,<script>alert(1)</script>').length, 0);
  assert.equal(links('data:https://example.com').length, 0);
  assert.equal(links('file:///C:/test').length, 0);
  assert.equal(links('file:https://example.com').length, 0);
  assert.equal(links('vbscript:msgbox(1)').length, 0);
  assert.equal(links('vbscript:https://example.com').length, 0);
  assert.equal(links('chrome://settings').length, 0);
  assert.equal(links('chrome:https://example.com').length, 0);
  assert.equal(links('about:blank').length, 0);
  assert.equal(links('about:https://example.com').length, 0);
  assert.equal(links('blob:https://example.com/abc').length, 0);
  assert.equal(links('abchttps://example.com').length, 0);
  assert.equal(links('x:https://example.com').length, 0);
  assert.equal(links('custom-scheme:https://example.com').length, 0);
  assert.equal(links('custom+scheme:https://example.com').length, 0);
  assert.equal(links('custom.scheme:https://example.com').length, 0);
  assert.deepEqual(parseChatMessageText('<script>alert(1)</script>'), [{ type: 'text', text: '<script>alert(1)</script>' }]);
  assert.deepEqual(parseChatMessageText('<img src=x onerror=alert(1)>'), [{ type: 'text', text: '<img src=x onerror=alert(1)>' }]);

  const longUrl = 'https://example.com/download/app.zip?token=abc123&code=xyz';
  const long = links(longUrl);
  assert.equal(long.length, 1);
  assert.equal(long[0].href, longUrl);
  assert.equal(long[0].text, longUrl);

  const chatTextSource = await readFile(path.join(root, 'src', 'ChatMessageText.tsx'), 'utf8');
  const guestSource = await readFile(path.join(root, 'src', 'visitor', 'GuestChat.tsx'), 'utf8');
  const adminSource = await readFile(path.join(root, 'src', 'admin', 'AdminDashboard.tsx'), 'utf8');

  assert.match(chatTextSource, /<a\s/);
  assert.match(chatTextSource, /href=\{part\.href\}/);
  assert.match(chatTextSource, /target="_blank"/);
  assert.match(chatTextSource, /rel="[^"]*\bnoopener\b[^"]*\bnoreferrer\b[^"]*"/);
  assert.match(chatTextSource, /onClick=\{keepLinkInteractionOnLink\}/);
  assert.match(chatTextSource, /onTouchStart=\{keepLinkInteractionOnLink\}/);
  assert.doesNotMatch(chatTextSource, /dangerouslySetInnerHTML|innerHTML/);

  assert.match(guestSource, /<ChatMessageText text=\{m\.content \|\| ''\}/);
  assert.match(adminSource, /<ChatMessageText text=\{m\.content \|\| ''\}/);
  assert.doesNotMatch(guestSource, /<span>\{m\.content \|\| '\[未知消息\]'\}<\/span>/);
  assert.doesNotMatch(adminSource, /<span>\{m\.content \|\| '\[未知消息\]'\}<\/span>/);
  assert.doesNotMatch(guestSource, /className="message-copy-btn"/);
  assert.match(guestSource, /copyMessageText\(String\(msg\.content \|\| ''\)\)/);
  assert.match(guestSource, /target\?\.closest\('a,button'\)/);

  // Visitor menu must only have copy and quote, no recall/delete
  assert.doesNotMatch(guestSource, /label: '\u64a4\u56de'/);
  assert.doesNotMatch(guestSource, /label: '\u5220\u9664'/);
  assert.match(guestSource, /label: '\u590d\u5236\u6587\u672c'/);
  assert.match(guestSource, /label: '\u5f15\u7528'/);

  // Admin menu retains recall/delete
  assert.match(adminSource, /label: '\u64a4\u56de'/);
  assert.match(adminSource, /label: '\u5220\u9664'/);

  console.log('chat message text link checks passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
