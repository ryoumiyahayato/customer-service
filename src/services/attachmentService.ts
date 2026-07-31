import { DomainError } from '../http/errors';
import { AttachmentRepository } from '../repositories/attachmentRepository';

const allowedTypes: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export class AttachmentService {
  constructor(
    private readonly attachments: AttachmentRepository,
    private readonly uploads: R2Bucket,
    private readonly idFactory: (prefix: string) => string,
    private readonly clock: () => string,
  ) {}

  async upload(input: {
    sessionId: string;
    file: File;
    createdByType: 'VISITOR' | 'OPERATOR';
    createdById: string;
  }) {
    const extension = allowedTypes[input.file.type];
    if (!extension) throw new DomainError('ATTACHMENT_INVALID_TYPE', 400);
    if (input.file.size > 5 * 1024 * 1024) {
      throw new DomainError('ATTACHMENT_TOO_LARGE', 413);
    }

    const objectKey = `${crypto.randomUUID()}.${extension}`;
    await this.uploads.put(objectKey, input.file.stream(), {
      httpMetadata: { contentType: input.file.type },
    });
    const createdAt = this.clock();
    await this.attachments.insert({
      id: this.idFactory('att'),
      sessionId: input.sessionId,
      objectKey,
      mimeType: input.file.type,
      byteSize: input.file.size,
      createdAt,
      createdByType: input.createdByType,
      createdById: input.createdById,
      expiresAt: new Date(Date.parse(createdAt) + 7 * 86400000).toISOString(),
    });
    return { path: `/api/attachments/${objectKey}` };
  }
}
