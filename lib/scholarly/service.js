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
import { assertNoLegacyCredentialFields, resolveScholarlyConfig, ScholarlyConfigSchema, } from './config.js';
import { ZOTERO_FULLTEXT_CHUNK_WORDS, ZOTERO_MAX_EVIDENCE_CHARS } from '../constants.js';
import { installParameterCorrection } from '../parameter-correction.js';
import { ZoteroJobRunner, jobPolicyOf, registerBackgroundAware } from '../job-runner.js';
import { registerResearchSkills } from '../skills/register.js';
import { SCHOLARLY_SOPS } from '../skills/scholarly.js';
import { resolveScholarlyKeys } from './credentials.js';
import { scholarlyJobSink } from './diagnostics.js';
import { ScholarlyTextStore } from './fulltext/store.js';
import { registerScholarlyPromptSection } from './prompt.js';
import { createScholarlyCitationsTool, createScholarlyCiteTool, createScholarlyGetTool, createScholarlyReadTool, createScholarlySaveToZoteroTool, createScholarlySearchTool, createScholarlyVerifyTool, } from './tools/index.js';
import { createScholarlyHttp } from './transport/http.js';
import { scholarlyPublicAccess, publicFetch } from '../transport/connections.js';
import { SCHOLARLY_TOOL_NAMES } from './types.js';
import { bm25EvidenceRanker } from '../local/evidence-ranker.js';
/**
 * Whether the save tool can ever succeed in this composition: the local Zotero
 * component must be mounted and its live write capability must be on. The
 * condition reads live state on every step, so a settings flip applies without
 * re-registering anything.
 * @param host - the scholarly tool host whose optional link is read.
 * @returns whether the save tool may be admitted to a step.
 */
export function canSaveScholarlyToZotero(host) {
    return host.zoteroService?.()?.writeEnabled?.() === true;
}
export class ScholarlyService extends Service {
    config;
    /** The tool host, exposed read-only for specs and diagnostics probes. */
    host;
    static Config = ScholarlyConfigSchema;
    static inject = ['tools', 'systemPrompt'];
    http;
    store;
    jobRunner;
    get currentConfig() {
        return resolveScholarlyConfig(this.config);
    }
    constructor(ctx, config = {}) {
        super(ctx, 'scholarly');
        this.config = config;
        assertNoLegacyCredentialFields(config);
        this.http = createScholarlyHttp({
            publicAccess: scholarlyPublicAccess,
            fetchImpl: publicFetch,
        });
        this.store = new ScholarlyTextStore();
        // Lazy like the core service (`src/service.ts`): a plugin-loaded jobs
        // registry may mount after this row, and an eagerly captured `undefined`
        // would permanently disable scholarly background runs and promotion.
        this.jobRunner = new ZoteroJobRunner(() => ctx.get('jobs'), scholarlyJobSink(ctx));
        ctx.effect(() => () => {
            this.jobRunner.killAll('scholarly service disposed');
            this.store.dispose();
            // Close the shared validating connection pool: the transport owns
            // it, and this effect is its only release path.
            return this.http.dispose();
        }, 'scholarly: text store and job teardown');
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
            keys: () => resolveScholarlyKeys(ctx, this.currentConfig),
            maxResults: () => this.currentConfig.maxResults,
            maxContentChars: () => this.currentConfig.maxContentChars,
            jobPolicy: () => jobPolicyOf(this.currentConfig),
            jobRunner: () => this.jobRunner,
            cache: this.store,
            // Optional dependency read through the official form: `ctx.get` returns
            // `undefined` when the local Zotero component is not composed, which is
            // exactly the in-library link's absent behavior.
            zoteroService: () => ctx.get('zotero'),
            // The enrichment component is a separate, optional bundle row. Its
            // enhancer is read from the core's slot, the same hand-off
            // `zotero_retrieve` consumes, so both tools observe one installed
            // instance and neither imports the component.
            enrichmentEnhancer: () => ctx.get('zotero')?.fulltextEnhancer?.(),
            // The ranking strategy and the chunk boundaries are read through the
            // local Zotero service, which owns both: its own lexical ranker while no
            // component is installed, and the live config that keeps
            // `scholarly_read` on the same passage boundaries as `zotero_retrieve`.
            // Reading per request keeps both tools on one strategy across a mount or
            // unmount, and keeps this subsystem from importing the enrichment
            // component at all. The fallbacks are the same defaults the core's
            // config schema ships, for the (rare) case where the local component is
            // not composed.
            evidenceRanker: () => ctx.get('zotero')?.evidenceRanker() ?? bm25EvidenceRanker,
            evidenceChunkLimits: () => {
                const limits = ctx.get('zotero')?.evidenceChunkLimits();
                return (limits ?? {
                    chunkWords: ZOTERO_FULLTEXT_CHUNK_WORDS,
                    chunkChars: ZOTERO_MAX_EVIDENCE_CHARS,
                });
            },
            ctx,
        };
        // The tools are registered once, here: they exist exactly as long as this
        // fiber does, because `ctx.tools.register()` is fiber-scoped. The save tool
        // is conditional: with writes disabled it could only ever answer
        // "write capability is disabled", which invites the model to retry it.
        this.host = host;
        const canSave = () => canSaveScholarlyToZotero(host);
        // The four tools whose schema never carries `run_in_background`.
        for (const tool of [
            createScholarlyGetTool(host),
            createScholarlyCitationsTool(host),
            createScholarlyCiteTool(host),
        ]) {
            ctx.tools.register(tool);
        }
        ctx.tools.register(createScholarlySaveToZoteroTool(host), { when: canSave });
        // The three heavy tools advertise the parameter only while the deployment
        // can serve it; the registration follows both the jobs service and the
        // live switch by itself.
        const disposeBackgroundTools = registerBackgroundAware(ctx, () => this.currentConfig.enableRunInBackground, (background) => {
            const disposers = [
                createScholarlySearchTool(host, { background }),
                createScholarlyReadTool(host, { background }),
                createScholarlyVerifyTool(host, { background }),
            ].map((tool) => ctx.tools.register(tool));
            return () => {
                for (const dispose of disposers)
                    dispose();
            };
        });
        ctx.effect(() => () => {
            disposeBackgroundTools();
        }, 'scholarly: background tool teardown');
        registerResearchSkills(ctx, SCHOLARLY_SOPS);
        installParameterCorrection(ctx, SCHOLARLY_TOOL_NAMES);
        // The component owns the policy the model reads about these tools, so the
        // prompt names an external capability only while that capability exists.
        registerScholarlyPromptSection(ctx, () => this.currentConfig);
    }
}
export default ScholarlyService;
//# sourceMappingURL=service.js.map