#!/usr/bin/env python3
from pathlib import Path

path = Path('scripts/doctor.mjs')
source = path.read_text(encoding='utf-8-sig')
source = source.replace(
    "if (name === 'src/worker.ts') return false;",
    "if (name === 'src/worker.ts' || name === 'src/runtimeWorker.ts') return false;",
)
old = "readTextIfExists(path.join(root, 'src/worker.ts'))"
count = source.count(old)
if count < 2:
    raise SystemExit(f'expected at least two Worker implementation checks, found {count}')
source = source.replace(old, "readTextIfExists(path.join(root, 'src/runtimeWorker.ts'))")
source = source.replace('src/worker.ts is missing, so the scheduled handler could not be checked.', 'src/runtimeWorker.ts is missing, so the scheduled handler could not be checked.')
source = source.replace('src/worker.ts is missing, so setup API static checks could not run.', 'src/runtimeWorker.ts is missing, so setup API static checks could not run.')
path.write_text(source, encoding='utf-8')
print('doctor now inspects runtimeWorker.ts for runtime behavior')
