export { ChatRoom } from './worker';
import secureWorker from './worker-secure';

// Compatibility shim kept only so older PR diffs and imports do not retain a separate Worker wrapper.
// The active deployment entrypoint is src/worker-secure.ts, where audit logging now lives.
export default secureWorker;
