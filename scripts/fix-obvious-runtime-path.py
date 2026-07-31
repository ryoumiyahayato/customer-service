#!/usr/bin/env python3
from pathlib import Path

path = Path('scripts/check-obvious-code-issues.mjs')
source = path.read_text(encoding='utf-8-sig')
old = "const workerFile = path.join(root, 'src', 'worker.ts');"
if source.count(old) != 2:
    raise SystemExit(f'expected two worker path anchors, got {source.count(old)}')
source = source.replace(old, "const workerFile = path.join(root, 'src', 'runtimeWorker.ts');")
path.write_text(source, encoding='utf-8')
print('obvious checks now inspect runtimeWorker.ts')
