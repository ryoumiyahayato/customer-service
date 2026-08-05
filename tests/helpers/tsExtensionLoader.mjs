import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

export function registerTypeScriptHooks() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        const relative = specifier.startsWith('./') || specifier.startsWith('../');
        const hasExtension = /\.[A-Za-z0-9]+$/.test(specifier);
        if (error?.code === 'ERR_MODULE_NOT_FOUND' && relative && !hasExtension) {
          return nextResolve(`${specifier}.ts`, context);
        }
        throw error;
      }
    },
    load(url, context, nextLoad) {
      if (!url.endsWith('.ts')) return nextLoad(url, context);
      return {
        format: 'module',
        shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }),
      };
    },
  });
}
