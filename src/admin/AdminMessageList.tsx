import type { ReactNode } from 'react';
import { LoadingState, StatusBlock } from '../ui/StatusBlock';

type AdminMessageListProps<T> = {
  messages: T[];
  renderMessage: (message: T) => ReactNode;
  loading?: boolean;
  emptyText?: ReactNode;
  showEmpty?: boolean;
};

export default function AdminMessageList<T>({
  messages,
  renderMessage,
  loading = false,
  emptyText,
  showEmpty = false,
}: AdminMessageListProps<T>) {
  return (
    <div className="msgs">
      {loading ? <LoadingState>正在加载会话消息...</LoadingState> : null}
      {!loading && showEmpty && emptyText ? <StatusBlock>{emptyText}</StatusBlock> : null}
      {messages.map(renderMessage)}
    </div>
  );
}
