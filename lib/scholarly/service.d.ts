/**
 * Cordis Service plugin providing `ctx.scholarly`.
 *
 * Mounts the external literature retrieval subsystem as a first-class DSH
 * component: seven model tools, one shared HTTP transport, and one text store.
 *
 * The component's presence is the authorization. While the service is not
 * mounted, `ctx.scholarly` does not exist, the transport does not exist, and
 * no request can leave the host. A mounted service registers its seven tools
 * once and owns a prompt section; unmounting it withdraws both.
 *
 * Two lifecycle facts this file is responsible for:
 *
 * - **Tools are effects.** `ctx.tools.register()` is fiber-scoped, so
 *   registering from this constructor is disposal-safe.
 * - **The store outlives no fiber.** The text store owns a directory and an
 *   in-memory map, so its teardown is a declared effect.
 *
 * @module dsh-zotero/scholarly/service
 */
import { Context, Service } from '@deepseek-ai/cordis';
import { type ScholarlyConfig } from './config.js';
import type { ScholarlyToolHost } from './tools/common.js';
import { ScholarlyTextStore } from './fulltext/store.js';
import { type ScholarlyReadHost } from './tools/index.js';
import { type ScholarlyHttp } from './transport/http.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        scholarly: ScholarlyService;
    }
}
/**
 * Whether the save tool can ever succeed in this composition: the local Zotero
 * component must be mounted and its live write capability must be on. The
 * condition reads live state on every step, so a settings flip applies without
 * re-registering anything.
 * @param host - the scholarly tool host whose optional link is read.
 * @returns whether the save tool may be admitted to a step.
 */
export declare function canSaveScholarlyToZotero(host: Pick<ScholarlyToolHost, 'zoteroService'>): boolean;
export declare class ScholarlyService extends Service {
    config: ScholarlyConfig;
    /** The tool host, exposed read-only for specs and diagnostics probes. */
    readonly host: ScholarlyReadHost;
    static readonly Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        email: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        s2ApiKeyEnv: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        ncbiApiKeyEnv: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        openalexApiKeyEnv: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        maxResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxContentChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        enableRunInBackground: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        promoteOnTimeout: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        foregroundWaitMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        email: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        s2ApiKeyEnv: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        ncbiApiKeyEnv: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        openalexApiKeyEnv: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        maxResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxContentChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        enableRunInBackground: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        promoteOnTimeout: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        foregroundWaitMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    }>>, "plain">;
    static readonly inject: string[];
    readonly http: ScholarlyHttp;
    readonly store: ScholarlyTextStore;
    private readonly jobRunner;
    private get currentConfig();
    constructor(ctx: Context, config?: ScholarlyConfig);
}
export default ScholarlyService;
//# sourceMappingURL=service.d.ts.map