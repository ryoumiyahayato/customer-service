export { ChatRoom } from './runtimeWorker';
export type { Env } from './runtimeWorker';

import runtimeWorker from './runtimeWorker';
import { createHistoryClearGuard } from './services/historyClearGuard';

export default createHistoryClearGuard(runtimeWorker);
