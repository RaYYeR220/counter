// Lets Node run this package's TypeScript sources directly (with its built-in
// type stripping): extensionless relative imports resolve to `.ts` files.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (err?.code !== "ERR_MODULE_NOT_FOUND" || !/^\.\.?\//.test(specifier)) throw err;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
