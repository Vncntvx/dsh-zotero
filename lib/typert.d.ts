/**
 * The hand-written host Typert manifest for the zotero Remote. Registered
 * through `ctx.typert.register` in the plugin body, not as a generated
 * `./typert` artifact: Typert's generator runs only inside a workspace root
 * that contains both `tsconfig.host.json` and `packages/`, and this
 * repository is a standalone checkout with neither, so no artifact can be
 * generated here. The registry documents `ctx.typert.register()` as the path
 * for hand-written wire schemas. No `./typert` export is declared on purpose:
 * the production Loader row is the bare package name `dsh-zotero`, which
 * dsh-typert-loader's entry discovery would resolve, and registering the same
 * `package#face` again fails with "already registered" (see service.ts).
 * The strict registry is the Host Gateway's preferred resolution path for
 * `zotero/status` and needs no `@Remote` markers.
 *
 * Both halves register the same lazy invocation descriptors from the
 * client-safe `wire-schemas.ts`. Structural endpoint identity is shared
 * through `contract.ts`. The service key spells {@link ZOTERO_STATUS_SERVICE_KEY}, the same
 * constant the host Remote service and the invocation descriptor use.
 *
 * The manifest declares the `zoteroLibrary` service of the separate
 * `dsh-zotero/library` bundle row. Deliberate: Typert binds endpoints by
 * composed service at runtime, so with the row disabled nothing answers, but
 * the declaration stays here because the manifest is one static contribution
 * per package. The browser-side `whileServed('library')` watch
 * (`client/index.ts`) mounts library panel surfaces only while the row is served.
 * The core SourcesTab has a separate URL PDF action gate: its live library
 * preference snapshot must exist and permit URL PDF reading before dispatch.
 * Turning the library row off revokes that snapshot and blocks the core action.
 * @module dsh-zotero/typert
 */
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types';
/** The zotero namespace's host manifest (strict codecs owned by this half). */
export declare const TYPERT_MANIFEST: TypertContribution;
//# sourceMappingURL=typert.d.ts.map