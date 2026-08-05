import * as Module from 'node:module';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';

registerTypeScriptHooks();
const load = Module.createRequire(import.meta.url);
load('./sessionTransitions.runner.mjs');
