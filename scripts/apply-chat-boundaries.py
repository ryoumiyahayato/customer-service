#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path.cwd()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8-sig")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing anchor: {label}")
    return source.replace(old, new, 1)


api = read("src/api.ts")
api = replace_required(
    api,
    "import { isAbortControllerSupported, isAbortError } from './compat';",
    "import { isAbortControllerSupported, isAbortError } from './compat';\n"
    "import { normalizeApiPayload } from './chat/mappers';",
    "api mapper import",
)
api = replace_required(
    api,
    "    const data = await parseBody(response);\n"
    "    if (!response.ok) throw new ApiError(messageForStatus(response.status, data, pathFromInput(input)), response.status, data);\n"
    "    return data;",
    "    const rawData = await parseBody(response);\n"
    "    if (!response.ok) throw new ApiError(messageForStatus(response.status, rawData, pathFromInput(input)), response.status, rawData);\n"
    "    return normalizeApiPayload(rawData);",
    "api response mapper",
)
write("src/api.ts", api)

replacements = [
    ("session_id", "sessionId"),
    ("sender_type", "senderType"),
    ("sender_id", "senderId"),
    ("message_type", "messageType"),
    ("image_path", "imagePath"),
    ("created_at", "createdAt"),
    ("read_at", "readAt"),
    ("is_read", "isRead"),
    ("quote_message_id", "quoteMessageId"),
    ("client_message_id", "clientMessageId"),
    ("recalled_at", "recalledAt"),
    ("deleted_at", "deletedAt"),
    ("image_purged_at", "imagePurgedAt"),
    ("visitor_key", "visitorKey"),
    ("user_id", "userId"),
    ("customer_name", "customerName"),
    ("customer_remark_name", "customerRemarkName"),
    ("assigned_operator_id", "assignedOperatorId"),
    ("archived_at", "archivedAt"),
    ("purged_at", "purgedAt"),
    ("history_cleared_at", "historyClearedAt"),
    ("updated_at", "updatedAt"),
    ("unread_count", "unreadCount"),
    ("must_change_password", "mustChangePassword"),
    ("is_disabled", "isDisabled"),
    ("last_seen_at", "lastSeenAt"),
    ("sender_admin_id", "senderAdminId"),
    ("sender_name", "senderName"),
    ("display_name", "displayName"),
    ("source_operator_id", "sourceOperatorId"),
    ("expires_at", "expiresAt"),
]
for directory in ("src/admin", "src/visitor"):
    for target in (ROOT / directory).rglob("*"):
        if target.suffix not in {".ts", ".tsx"}:
            continue
        source = target.read_text(encoding="utf-8-sig")
        for old, new in replacements:
            source = re.sub(rf"\b{re.escape(old)}\b", new, source)
        target.write_text(source, encoding="utf-8")

guard = read("src/admin/activeSessionGuard.ts")
guard = re.sub(
    r"const item = message as \{[^}]+\} \| null \| undefined;\n"
    r"  const sessionId = String\([^;]+;",
    "const item = message as { sessionId?: unknown } | null | undefined;\n"
    "  const sessionId = String(item?.sessionId || '');",
    guard,
    count=1,
)
write("src/admin/activeSessionGuard.ts", guard)

dashboard = read("src/admin/AdminDashboard.tsx")
dashboard = replace_required(
    dashboard,
    "  isSessionEnded,\n",
    "  isSessionEnded,\n  parseChatRealtimeEvent,\n  sessionGroupOf,\n",
    "dashboard parser imports",
)
dashboard, count = re.subn(
    r"const isArchivedSession = .*?\n"
    r"const sessionGroupOf = \(session\?: Session \| null\): SessionGroup \| null => \{\n"
    r".*?\n\};\n",
    "",
    dashboard,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError("missing dashboard local lifecycle block")
dashboard = replace_required(
    dashboard,
    "ws.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === 'sessions:changed') fetchSessions(); } catch {} };",
    "ws.onmessage = (e) => { try { const d = parseChatRealtimeEvent(JSON.parse(e.data)); if (d?.type === 'sessions:changed') fetchSessions(); } catch {} };",
    "dashboard admin websocket parser",
)
dashboard = replace_required(
    dashboard,
    "        const d = JSON.parse(e.data);\n        const sidFromEvent",
    "        const d = parseChatRealtimeEvent(JSON.parse(e.data));\n"
    "        if (!d) return;\n"
    "        const sidFromEvent",
    "dashboard conversation websocket parser",
)
write("src/admin/AdminDashboard.tsx", dashboard)

guest = read("src/visitor/GuestChat.tsx")
guest = replace_required(
    guest,
    "  isSessionEnded,\n",
    "  isSessionEnded,\n  parseChatRealtimeEvent,\n",
    "guest parser import",
)
guest = replace_required(
    guest,
    "        const d = JSON.parse(e.data);\n        if (isMessageCreatedEvent(d.type)) {",
    "        const d = parseChatRealtimeEvent(JSON.parse(e.data));\n"
    "        if (!d) return;\n"
    "        if (isMessageCreatedEvent(d.type)) {",
    "guest websocket parser",
)
write("src/visitor/GuestChat.tsx", guest)

package = json.loads(read("package.json"))
package["type"] = "module"
scripts = package["scripts"]
scripts["check:static-contracts"] = "node scripts/check-session-lifecycle.mjs"
scripts["test:unit"] = "node --experimental-strip-types --test tests/unit/*.test.mjs"
scripts["test:integration"] = "node --experimental-sqlite --test tests/integration/*.test.mjs"
scripts["test"] = "npm run test:unit && npm run test:integration"
write("package.json", json.dumps(package, ensure_ascii=False, indent=2) + "\n")

workflow = read(".github/workflows/productization-validation.yml")
workflow = workflow.replace(
    "run: npm run check-session-lifecycle-static",
    "run: npm run check:static-contracts",
)
workflow = workflow.replace(
    "      - name: Root unit behavior tests\n"
    "        run: npm run test:unit\n",
    "      - name: Root unit tests\n"
    "        run: npm run test:unit\n\n"
    "      - name: Root SQLite integration tests\n"
    "        run: npm run test:integration\n",
)
write(".github/workflows/productization-validation.yml", workflow)

(ROOT / "scripts/apply-chat-boundaries.py").unlink(missing_ok=True)
(ROOT / ".github/workflows/apply-chat-boundaries.yml").unlink(missing_ok=True)
print("chat boundary transformation completed")
