export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string };

const HTTPS_URL_CANDIDATE = /https:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[),.;:!?，。！？；：）]+$/;
const SAFE_URL_PREFIX = /[\s([{"'`]/;

function trimTrailingPunctuation(value: string) {
  const trailing = value.match(TRAILING_PUNCTUATION)?.[0] || '';
  return {
    url: trailing ? value.slice(0, -trailing.length) : value,
    trailing,
  };
}

export function isSafeHttpsUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasSafeUrlPrefix(text: string, index: number) {
  if (index === 0) return true;
  return SAFE_URL_PREFIX.test(text[index - 1]);
}

export function parseChatMessageText(input: string): ChatMessagePart[] {
  const parts: ChatMessagePart[] = [];
  const text = String(input || '');
  let cursor = 0;

  for (const match of text.matchAll(HTTPS_URL_CANDIDATE)) {
    const raw = match[0];
    const index = match.index || 0;
    const { url, trailing } = trimTrailingPunctuation(raw);

    if (!hasSafeUrlPrefix(text, index) || !url || !isSafeHttpsUrl(url)) continue;

    if (index > cursor) {
      parts.push({ type: 'text', text: text.slice(cursor, index) });
    }

    parts.push({ type: 'link', text: url, href: url });
    if (trailing) parts.push({ type: 'text', text: trailing });
    cursor = index + raw.length;
  }

  if (cursor < text.length) {
    parts.push({ type: 'text', text: text.slice(cursor) });
  }

  return parts.length ? parts : [{ type: 'text', text }];
}
