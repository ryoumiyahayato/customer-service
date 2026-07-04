import type { ReactNode, RefObject } from 'react';
import { LoadingState, StatusBlock } from '../ui/StatusBlock';

type GuestMessageListProps<T> = {
  messages: T[];
  renderMessage: (message: T) => ReactNode;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  uploadingImage: boolean;
};

export default function GuestMessageList<T>({
  messages,
  renderMessage,
  messagesEndRef,
  uploadingImage,
}: GuestMessageListProps<T>) {
  return (
    <div className="msgs">
      {messages.length === 0 && <StatusBlock className="chat-empty-state" title="还没有消息">发送第一条消息，客服看到后会尽快回复。</StatusBlock>}
      {messages.map(renderMessage)}
      {uploadingImage && <LoadingState className="msg user sending-msg">正在上传图片...</LoadingState>}
      <div ref={messagesEndRef} />
    </div>
  );
}
