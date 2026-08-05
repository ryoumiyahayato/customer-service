export function newClientMessageId() {
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `cm_${id}`;
}

export function localMessageId(clientMessageId: string) {
  return `local-${clientMessageId}`;
}
