// Registers the `@/` resolver so src TypeScript can run directly under Node's
// type stripping. Test harness only.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./ts-resolver.mjs', pathToFileURL(import.meta.filename));
