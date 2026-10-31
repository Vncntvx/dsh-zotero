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
        email: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        s2Key: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        ncbiKey: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        openalexKey: import("@deepseek-ai/schemastery").default<string, string, "volatile">;
        maxResults: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        maxContentChars: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
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
    private get currentConfig();
    constructor(ctx: Context, config?: ScholarlyConfig);
}
export default ScholarlyService;
//# sourceMappingURL=service.d.ts.map