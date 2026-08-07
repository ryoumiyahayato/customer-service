import type { NormalizedSessionStatus, SessionGroup } from '../domain/sessionState.ts';

export type { SessionGroup } from '../domain/sessionState.ts';

export type MessageStatus = 'sending' | 'sent' | 'read' | 'failed' | 'recalled';
export type MessageType = 'text' | 'image';
export type SenderType = 'VISITOR' | 'OPERATOR';

export type ChatMessage = {
  id: string;
  sessionId: string;
  senderType: SenderType;
  senderId: string | null;
  content: string;
  messageType: MessageType;
  imagePath: string | null;
  status: MessageStatus;
  createdAt: string;
  readAt: string | null;
  isRead: boolean;
  quoteMessageId: string | null;
  clientMessageId: string | null;
  recalledAt: string | null;
  deletedAt: string | null;
  imagePurgedAt: string | null;
};

export type ChatSession = {
  id: string;
  status: NormalizedSessionStatus;
  visitorKey: string | null;
  userId: string | null;
  customerName: string | null;
  customerRemarkName: string | null;
  assignedOperatorId: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  purgedAt: string | null;
  historyClearedAt: string | null;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
  deviceLabel?: string | null;
  approximateLocation?: string | null;
  clientMetadataCapturedAt?: string | null;
  ipAddress?: string | null;
};

export type AdminIdentity = {
  id: string;
  username: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  mustChangePassword?: boolean;
};

export type OperatorSummary = {
  id: string;
  username: string;
  isDisabled?: boolean;
  online?: boolean;
  lastSeenAt?: string | null;
};

export type StaffMessage = {
  id: string;
  senderAdminId: string;
  senderName: string;
  content: string;
  createdAt: string;
};

export type ClearHistoryCounts = {
  messages: number;
  attachments: number;
  r2Objects: number;
};

export type ClearHistoryPlan = {
  session: ChatSession;
  counts: ClearHistoryCounts;
};

export type ChatSessionGroup = SessionGroup;