export type DomainErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ENDED'
  | 'SESSION_STATE_CONFLICT'
  | 'RESTORE_NOT_SUPPORTED'
  | 'MESSAGE_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'RATE_LIMITED'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENT_INVALID_TYPE'
  | 'ATTACHMENT_TOO_LARGE'
  | 'INTERNAL_ERROR';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    public readonly status: number,
    message = code,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}