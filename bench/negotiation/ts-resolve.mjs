// Lets Node load the TypeScript workspace sources directly: Node strips the
// types, and this hook adds the `.ts` extension that bundler-style imports omit.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier)) throw err;
      return next(`${specifier}.ts`, context);
    }
  },
});
