/**
 * The hand-written host Typert manifest for the zotero Remote. Registered
 * through `ctx.typert.register` in the plugin body — not via a `./typert`
 * export, because dsh-typert-loader's auto-discovery only resolves
 * bare-package-name rows and would double-register this manifest on the
 * production profile where the plugin also self-registers (see service.ts).
 * The strict registry is the Host Gateway's preferred resolution path for
 * `zotero/status` and needs no `@Remote` markers; avoiding the decorators
 * also keeps the source runnable under Node's plain TypeScript type
 * stripping, which rejects decorator syntax.
 *
 * Invocations come from `status-codec.ts` (host zod factories). Structural endpoint identity is shared with the client through
 * `contract.ts`; only this half materializes boundary schemas. The model's
 * service key spells {@link ZOTERO_STATUS_SERVICE_KEY} — the same constant
 * the host Remote service and the invocation descriptor use.
 * @module dsh-zotero/typert
 */
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types';
/** The zotero namespace's host manifest (strict codecs owned by this half). */
export declare const TYPERT_MANIFEST: TypertContribution;
//# sourceMappingURL=typert.d.ts.map