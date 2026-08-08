import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, transform) {
  const before = readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`${path}: transform made no change`);
  writeFileSync(path, after);
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, got ${count}`);
  return source.replace(before, after);
}

patch('src/worker-final.ts', source => {
  let next = replaceOnce(
    source,
    "export { ChatRoom } from './worker-entry';\nimport worker from './worker-entry';",
    "export { ChatRoom } from './worker-preset';\nimport worker from './worker-preset';",
    'worker-final preset wrapper',
  );
  next = replaceOnce(next, '    welcomeText: presentation.welcomeText,\n', '', 'worker-final remove welcome payload');
  return next;
});

for (const path of ['src/worker-entry.ts', 'src/worker-presentation.ts']) {
  patch(path, source => replaceOnce(
    source,
    '    welcomeText: presentation.welcomeText,\n',
    '',
    `${path} remove welcome payload`,
  ));
}

console.log('PR52 preset worker integration applied');
