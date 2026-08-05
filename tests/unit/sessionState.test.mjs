import './sessionState.base.mjs';
import './sessionState.invalid.mjs';

export const legacyClosed = 'CLOSED';
export const expectedActiveStatuses = ['OPEN', 'PENDING'];
export const behaviorEvidence = 'fails closed for unknown or missing stored statuses';
