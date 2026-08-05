export { ChatRoom } from './runtimeWorker';
export type { Env } from './runtimeWorker';

import runtimeWorker from './runtimeWorker';
import { createHistoryClearGuard } from './services/historyClearGuard';
import { createRequestPolicyGuard } from './services/requestPolicyGuard';

const policyGuardedWorker = createRequestPolicyGuard(runtimeWorker);
export default createHistoryClearGuard(policyGuardedWorker);
