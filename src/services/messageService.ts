import { MessageRepository, type MessageRecord } from '../repositories/messageRepository';
import { DomainError } from '../http/errors';

export type CreateMessageInput = {
  sessionId: string;
  senderType: 'VISITOR' | 'OPERATOR';
  senderId: string;
  content: string;
  messageType: 'text' | 'image';
  imagePath: string | null;
  quoteMessageId: string | null;
  clientMessageId: string;
};

export class MessageService {
  constructor(
    private readonly messages: MessageRepository,
    private readonly idFactory: (prefix: string) => string,
    private readonly clock: () => string,
    private readonly attachmentKeyFromPath: (path?: string | null) => string,
  ) {}

  async create(input: CreateMessageInput) {
    const existing = await this.messages.findDuplicate(
      input.sessionId,
      input.senderType,
      input.senderId,
      input.clientMessageId,
    );
    if (existing) return { message: existing, deduped: true };

    const timestamp = this.clock();
    const message: MessageRecord = {
      id: this.idFactory('msg'),
      session_id: input.sessionId,
      sender_type: input.senderType,
      sender_id: input.senderId,
      content: input.content,
      message_type: input.messageType,
      image_path: input.imagePath,
      status: 'sent',
      created_at: timestamp,
      read_at: null,
      is_read: 0,
      quote_message_id: input.quoteMessageId,
      recalled_at: null,
      image_purged_at: null,
      client_message_id: input.clientMessageId,
    };

    let inserted = false;
    try {
      inserted = await this.messages.insertWithQuota(message);
    } catch (error) {
      const duplicate = await this.messages.findDuplicate(
        input.sessionId,
        input.senderType,
        input.senderId,
        input.clientMessageId,
      );
      if (duplicate) return { message: duplicate, deduped: true };
      throw error;
    }
    if (!inserted) throw new DomainError('MESSAGE_QUOTA_EXCEEDED', 429);

    const attachmentKey = message.message_type === 'image'
      ? this.attachmentKeyFromPath(message.image_path)
      : '';
    if (attachmentKey) await this.messages.bindAttachment(message, attachmentKey);
    await this.messages.touchSession(input.sessionId, timestamp);
    return { message, deduped: false };
  }
}
