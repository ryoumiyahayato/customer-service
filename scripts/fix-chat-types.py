#!/usr/bin/env python3
from pathlib import Path

root = Path.cwd()


def replace_required(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'missing anchor: {label}')
    return text.replace(old, new, 1)


admin_path = root / 'src/admin/AdminDashboard.tsx'
admin = admin_path.read_text(encoding='utf-8-sig')
old_ws = """        const sidFromEvent = eventSessionId(d, sid);
        if (sidFromEvent && sidFromEvent !== sid) { if (d.session) setSessions(prev => prev.map(s => s.id === d.session.id ? { ...s, ...d.session } : s)); return; }
        if (!isActiveAdminSession(sid)) { if (d.session) setSessions(prev => prev.map(s => s.id === d.session.id ? { ...s, ...d.session } : s)); return; }
        if ((isMessageCreatedEvent(d.type) || d.type === 'message:updated') && d.message && !messageBelongsToActiveSession(d.message, sid)) return;
        if (d.type === 'message:new' || d.type === 'message_created') { setSelectedMsgs(prev => mergeMessage(filterMessagesForSession(prev, sid), d.message)); if (d.session) { setCur(c => c?.id === d.session.id ? d.session : c); } }
        else if (d.type === 'message:updated') { setSelectedMsgs(prev => mergeMessage(filterMessagesForSession(prev, sid), d.message)); }
        else if (d.type === 'messages:read') { setSelectedMsgs(prev => applyReadReceipt(filterMessagesForSession(prev, sid), d.messageIds, d.readAt)); }
        else if (d.type === 'message:deleted') { setSelectedMsgs(prev => filterMessagesForSession(prev, sid).map(m => m.id === d.messageId ? { ...m, deletedAt: new Date().toISOString() } : m)); }
        else if (d.type === 'session:updated') { setCur(c => c?.id === d.session?.id ? { ...c, ...d.session } : c); }"""
new_ws = """        const sidFromEvent = eventSessionId(d, sid);
        const eventSession = d.type === 'session:updated'
          ? d.session
          : d.type === 'message:new' || d.type === 'message_created'
            ? d.session
            : undefined;
        if (sidFromEvent && sidFromEvent !== sid) {
          if (eventSession) setSessions(prev => prev.map(session => session.id === eventSession.id ? { ...session, ...eventSession } : session));
          return;
        }
        if (!isActiveAdminSession(sid)) {
          if (eventSession) setSessions(prev => prev.map(session => session.id === eventSession.id ? { ...session, ...eventSession } : session));
          return;
        }
        if (d.type === 'message:new' || d.type === 'message_created') {
          if (!messageBelongsToActiveSession(d.message, sid)) return;
          setSelectedMsgs(prev => mergeMessage(filterMessagesForSession(prev, sid), d.message));
          const sessionUpdate = d.session;
          if (sessionUpdate) setCur(current => current?.id === sessionUpdate.id ? sessionUpdate : current);
        } else if (d.type === 'message:updated') {
          if (!messageBelongsToActiveSession(d.message, sid)) return;
          setSelectedMsgs(prev => mergeMessage(filterMessagesForSession(prev, sid), d.message));
        } else if (d.type === 'messages:read') {
          setSelectedMsgs(prev => applyReadReceipt(filterMessagesForSession(prev, sid), d.messageIds, d.readAt));
        } else if (d.type === 'message:deleted') {
          setSelectedMsgs(prev => filterMessagesForSession(prev, sid).map(message =>
            message.id === d.messageId ? { ...message, deletedAt: new Date().toISOString() } : message
          ));
        } else if (d.type === 'session:updated') {
          setCur(current => current?.id === d.session.id ? { ...current, ...d.session } : current);
        }"""
admin = replace_required(admin, old_ws, new_ws, 'admin websocket block')
admin = admin.replace(
    "      clientMessageId: clientMessageId\n    };",
    "      clientMessageId: clientMessageId,\n      recalledAt: null,\n      deletedAt: null,\n      imagePurgedAt: null\n    };",
    1,
)
admin = admin.replace(
    "clientMessageId: clientMessageId }",
    "clientMessageId: clientMessageId, recalledAt: null, deletedAt: null, imagePurgedAt: null }",
)
admin_path.write_text(admin, encoding='utf-8')

guest_path = root / 'src/visitor/GuestChat.tsx'
guest = guest_path.read_text(encoding='utf-8-sig')
guest = guest.replace(
    "      clientMessageId: clientMessageId\n    };",
    "      clientMessageId: clientMessageId,\n      recalledAt: null,\n      deletedAt: null,\n      imagePurgedAt: null\n    };",
    1,
)
guest = guest.replace(
    "clientMessageId: clientMessageId }",
    "clientMessageId: clientMessageId, recalledAt: null, deletedAt: null, imagePurgedAt: null }",
)
guest_path.write_text(guest, encoding='utf-8')

print('realtime narrowing and optimistic message fixes applied')
