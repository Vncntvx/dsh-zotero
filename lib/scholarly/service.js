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
import { Service } from '@deepseek-ai/cordis';
import { resolveScholarlyConfig, ScholarlyConfigSchema, } from './config.js';
import { ScholarlyTextStore } from './fulltext/store.js';
import { registerScholarlyPromptSection } from './prompt.js';
import { createAllScholarlyTools } from './tools/index.js';
import { createScholarlyHttp } from './transport/http.js';
export class ScholarlyService extends Service {
    config;
    static Config = ScholarlyConfigSchema;
    static inject = ['tools', 'systemPrompt'];
    http;
    store;
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
            ctx,
        };
        // The tools are registered once, here: they exist exactly as long as this
        // fiber does, because `ctx.tools.register()` is fiber-scoped.
        for (const tool of createAllScholarlyTools(host))
            ctx.tools.register(tool);
        // The component owns the policy the model reads about these tools, so the
        // prompt names an external capability only while that capability exists.
        registerScholarlyPromptSection(ctx, () => this.currentConfig);
    }
}
export default ScholarlyService;
//# sourceMappingURL=service.js.map