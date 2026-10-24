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
import { Service } from '@deepseek-ai/cordis';
import { resolveScholarlyConfig, ScholarlyConfigSchema, } from './config.js';
import { ScholarlyTextStore } from './fulltext/store.js';
import { createAllScholarlyTools } from './tools/index.js';
import { createScholarlyHttp } from './transport/http.js';
export class ScholarlyService extends Service {
    config;
    static Config = ScholarlyConfigSchema;
    static inject = ['tools'];
    http;
    store;
    toolDisposes = [];
    get currentConfig() {
        return resolveScholarlyConfig(this.config);
    }
    constructor(ctx, config = {}) {
        super(ctx, 'scholarly');
        this.config = config;
        this.http = createScholarlyHttp();
        this.store = new ScholarlyTextStore();
        ctx.effect(() => () => this.store.dispose(), 'scholarly: text store teardown');
        // This component ships its own settings page (the `plugins.row.config`
        // surface the client registers), so the schema-generated page would be a
        // second, conflicting surface for the same namespace. The optional child
        // lets a late-loading Settings service pick the policy up, and the row
        // still runs without Settings composed (`packages/settings/settings/README.md`).
        ctx.inject(['settings'], (settingsCtx) => {
            settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
        });
        const host = {
            http: this.http,
            keys: () => ({
                email: this.currentConfig.email,
                s2Key: this.currentConfig.s2Key,
                ncbiKey: this.currentConfig.ncbiKey,
                openalexKey: this.currentConfig.openalexKey,
            }),
            maxResults: () => this.currentConfig.maxResults,
            maxContentChars: () => this.currentConfig.maxContentChars,
            cache: this.store,
            // Optional dependency read through the official form: `ctx.get` returns
            // `undefined` when the local Zotero component is not composed, which is
            // exactly the in-library link's absent behavior.
            zoteroService: () => ctx.get('zotero'),
        };
        this.reconcileTools(ctx, host);
        ctx.on('loader/volatile-update', () => this.reconcileTools(ctx, host));
    }
    reconcileTools(ctx, host) {
        // Tools read every other setting through `host` at call time; only the
        // enablement flag changes which tools exist, so a key or limit edit must
        // not churn the registry.
        const registered = this.toolDisposes.length > 0;
        if (this.currentConfig.enabled === registered)
            return;
        for (const dispose of this.toolDisposes)
            dispose();
        this.toolDisposes = [];
        if (!this.currentConfig.enabled)
            return;
        this.toolDisposes = createAllScholarlyTools(host).map((tool) => ctx.tools.register(tool));
    }
}
export default ScholarlyService;
//# sourceMappingURL=service.js.map