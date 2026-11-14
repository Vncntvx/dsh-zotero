import { hostSafePathDeps, resolveSafeDirectoryPath } from './safe-directory-path.js';
import { ZoteroError } from '../errors.js';
export const hostSafeDirectoryDeps = hostSafePathDeps;
/** Resolve one canonical root, translating refusals into a stable domain code. */
export async function resolveSafeDirectory(options) {
    return await resolveSafeDirectoryPath({
        configured: options.configured,
        defaultRoot: options.defaultRoot,
        create: options.create,
        readOnly: options.readOnly,
        allowMissing: options.allowMissing,
        deps: options.deps,
        refuse: (reason) => {
            throw new ZoteroError(`The ${options.label} is not usable: ${reason}`, options.errorCode);
        },
    });
}
//# sourceMappingURL=safe-directory.js.map