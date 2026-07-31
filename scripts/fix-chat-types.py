#!/usr/bin/env python3
from pathlib import Path

root = Path.cwd()

admin_path = root / 'src/admin/AdminDashboard.tsx'
admin = admin_path.read_text(encoding='utf-8-sig')
admin = admin.replace('  isMessageCreatedEvent,\n', '')
admin = admin.replace('  isSessionEnded,\n', '  isArchivedSession,\n  isSessionEnded,\n', 1)
admin = admin.replace('isRead: 1', 'isRead: true').replace('isRead: 0', 'isRead: false')
old_helper = "const eventSessionId = (event: ChatRealtimeEvent, fallbackSessionId: string) => String(event.session?.id || messageSessionId(event.message) || event.sessionId || fallbackSessionId || '');"
new_helper = """const eventSessionId = (event: ChatRealtimeEvent, fallbackSessionId: string) => {
  if (event.type === 'message:new' || event.type === 'message_created' || event.type === 'message:updated') {
    return event.message.sessionId || event.sessionId || fallbackSessionId;
  }
  if (event.type === 'session:updated') return event.session.id || event.sessionId || fallbackSessionId;
  if (event.type === 'messages:read' || event.type === 'message:deleted') return event.sessionId || fallbackSessionId;
  return fallbackSessionId;
};"""
if old_helper not in admin:
    raise RuntimeError('eventSessionId anchor missing')
admin = admin.replace(old_helper, new_helper, 1)
admin = admin.replace("if (isMessageCreatedEvent(d.type)) {", "if (d.type === 'message:new' || d.type === 'message_created') {")
admin_path.write_text(admin, encoding='utf-8')

guest_path = root / 'src/visitor/GuestChat.tsx'
guest = guest_path.read_text(encoding='utf-8-sig')
guest = guest.replace('  isMessageCreatedEvent,\n', '')
guest = guest.replace('isRead: 1', 'isRead: true').replace('isRead: 0', 'isRead: false')
guest = guest.replace("if (isMessageCreatedEvent(d.type)) {", "if (d.type === 'message:new' || d.type === 'message_created') {")
guest_path.write_text(guest, encoding='utf-8')

print('chat type fixes applied')
