// Minimal ESM resolver so `@/...` AND extensionless relative imports work when
// running src TS directly under Node's type stripping. Test harness only.
//
// WHY THE RELATIVE BRANCH IS NEEDED
//   Node's ESM loader requires an explicit file extension, but the source tree
//   (and the Next.js/TypeScript build) uses extensionless specifiers such as
//   `import { envelope } from './envelope'`. The original resolver only handled
//   the `@/` alias, so any module graph that crossed a relative import failed
//   with ERR_MODULE_NOT_FOUND. That went unnoticed until now because the only
//   src module under test - `@/lib/report/readiness` - imports a TYPE and
//   nothing else, and type imports are erased before resolution.
//
//   The reporting modules import each other relatively (`./connection`,
//   `./format`, `./types`), so the resolver has to handle both forms.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Extensions tried, in order, for an extensionless specifier. */
const CANDIDATES = (base) => [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')];

/** Resolve a filesystem base path to a TypeScript module URL, or null. */
function toTsModule(base) {
  for (const candidate of CANDIDATES(base)) {
    if (existsSync(candidate)) {
      return {
        url: pathToFileURL(candidate).href,
        shortCircuit: true,
        format: 'module-typescript',
      };
    }
  }
  return null;
}

/** True when the specifier already names a file extension Node can load. */
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

const isRelative = (s) => s.startsWith('./') || s.startsWith('../');

export async function resolve(specifier, context, nextResolve) {
  // `@/...` -> src/...
  if (specifier.startsWith('@/')) {
    const resolved = toTsModule(join(SRC, specifier.slice(2)));
    if (resolved) return resolved;
  }

  // Extensionless relative specifier -> resolve against the importing file.
  if (isRelative(specifier) && !HAS_EXTENSION.test(specifier) && context.parentURL) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const resolved = toTsModule(join(parentDir, specifier));
    if (resolved) return resolved;
  }

  return nextResolve(specifier, context);
}

