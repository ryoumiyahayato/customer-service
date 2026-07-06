import type { SyntheticEvent } from 'react';
import { parseChatMessageText } from './chatMessageTokens';

type ChatMessageTextProps = {
  text: string;
  fallback?: string;
};

function keepLinkInteractionOnLink(event: SyntheticEvent<HTMLAnchorElement>) {
  event.stopPropagation();
}

export default function ChatMessageText({ text, fallback = '[未知消息]' }: ChatMessageTextProps) {
  const content = text || fallback;
  return (
    <span className="message-text">
      {parseChatMessageText(content).map((part, index) => part.type === 'link'
        ? (
          <a
            key={`${part.href}-${index}`}
            className="message-link"
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={keepLinkInteractionOnLink}
            onPointerDown={keepLinkInteractionOnLink}
            onTouchStart={keepLinkInteractionOnLink}
          >
            {part.text}
          </a>
        )
        : <span key={index}>{part.text}</span>
      )}
    </span>
  );
}
