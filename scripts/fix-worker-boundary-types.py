#!/usr/bin/env python3
from pathlib import Path

root = Path.cwd()


def patch(path: str, replacements: list[tuple[str, str]]) -> None:
    target = root / path
    source = target.read_text(encoding='utf-8-sig')
    for old, new in replacements:
        if old not in source:
            raise RuntimeError(f'missing anchor in {path}: {old[:80]}')
        source = source.replace(old, new, 1)
    target.write_text(source, encoding='utf-8')


patch('src/runtimeWorker.ts', [
    (
        "import { jsonResponse } from './security/responseHeaders';",
        "import { SECURITY_HEADERS, jsonResponse } from './security/responseHeaders';",
    ),
    (
        "const noStoreHeaders = { 'cache-control': 'no-store', 'strict-transport-security': HSTS_HEADER };",
        "const noStoreHeaders = { 'cache-control': 'no-store', 'strict-transport-security': SECURITY_HEADERS['Strict-Transport-Security'] };",
    ),
    (
        "headers.set('strict-transport-security', HSTS_HEADER);",
        "headers.set('strict-transport-security', SECURITY_HEADERS['Strict-Transport-Security']);",
    ),
])

patch('src/worker-business-hardening.ts', [
    (
        "import { readJsonObjectWithinLimit } from './security/requestLimits';",
        "import { jsonObject, readJsonObjectWithinLimit } from './security/requestLimits';",
    ),
])

secure_path = root / 'src/worker-secure.ts'
secure = secure_path.read_text(encoding='utf-8-sig')
old = "async function hmac(secret: string, value: string) { return hmacHex(secret, value); }\n"
if old not in secure:
    raise RuntimeError('missing unused secure hmac delegate')
secure = secure.replace(old, '', 1)
secure = secure.replace("import { hmacHex, verifySignedValue } from './security/signing';", "import { verifySignedValue } from './security/signing';", 1)
secure_path.write_text(secure, encoding='utf-8')

print('worker boundary type fixes applied')
