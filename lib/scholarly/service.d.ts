/**
 * Cordis Service plugin providing `ctx.scholarly`.
 *
 * Mounts the external literature retrieval subsystem as a first-class DSH
 * component: seven model tools, one shared HTTP transport, and one text store.
 *
 * Two lifecycle facts this file is responsible for:
 *
 * - **Tools are effects.** `ctx.tools.register()` returns the exact disposer
 *   and is itself fiber-scoped, so registering from this constructor is
 *   disposal-safe; the disposers are dropped deliberately because fiber
 *   disposal unwinds them.
 * - **The store outlives no fiber.** The text store owns a directory and an
 *   in-memory map, so its teardown is a declared effect rather than an
 *   accident of process exit.
 *
 * @module dsh-zotero/scholarly/service
 */
import { Context, Service } from '@deepseek-ai/cordis';
import { type ScholarlyConfig } from './config.js';
import { ScholarlyTextStore } from './fulltext/store.js';
import { type ScholarlyHttp } from './transport/http.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        scholarly: ScholarlyService;
    }
}
export declare class ScholarlyService extends Service {
    config: ScholarlyConfig;
    static readonly Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        email: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        s2Key: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        ncbiKey: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        openalexKey: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        maxResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxContentChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        email: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        s2Key: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        ncbiKey: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        openalexKey: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        maxResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxContentChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    }>>, "plain">;
    static readonly inject: string[];
    readonly http: ScholarlyHttp;
    readonly store: ScholarlyTextStore;
    private toolDisposes;
    private get currentConfig();
    constructor(ctx: Context, config?: ScholarlyConfig);
    private reconcileTools;
}
export default ScholarlyService;
//# sourceMappingURL=service.d.ts.map