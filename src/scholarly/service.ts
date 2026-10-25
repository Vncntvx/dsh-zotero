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

import { Context, Service } from '@deepseek-ai/cordis'
// Type-only: brings the `ctx.settings` Context merge into this program.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: brings the `ctx.systemPrompt` Context merge into this program.
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  resolveScholarlyConfig,
  ScholarlyConfigSchema,
  type ResolvedScholarlyConfig,
  type ScholarlyConfig,
} from './config.js'
import { ScholarlyTextStore } from './fulltext/store.js'
import { registerScholarlyPromptSection } from './prompt.js'
import { createAllScholarlyTools, type ScholarlyReadHost } from './tools/index.js'
import { createScholarlyHttp, type ScholarlyHttp } from './transport/http.js'
import type { ScholarlyKeys } from './types.js'
import type { ZoteroServiceLike } from './zotero-link.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    scholarly: ScholarlyService
  }
}

export class ScholarlyService extends Service {
  static readonly Config = ScholarlyConfigSchema
  static readonly inject = ['tools', 'systemPrompt']

  public readonly http: ScholarlyHttp
  public readonly store: ScholarlyTextStore

  private get currentConfig(): ResolvedScholarlyConfig {
    return resolveScholarlyConfig(this.config)
  }

  constructor(
    ctx: Context,
    public config: ScholarlyConfig = {},
  ) {
    super(ctx, 'scholarly')

    this.http = createScholarlyHttp()
    this.store = new ScholarlyTextStore()
    ctx.effect(() => () => this.store.dispose(), 'scholarly: text store teardown')

    // This component ships its own settings page (the `plugins.row.config`
    // surface the client registers), so the schema-generated page would be a
    // second, conflicting surface for the same namespace. The optional child
    // lets a late-loading Settings service pick the policy up, and the row
    // still runs without Settings composed (`packages/settings/settings/README.md`).
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    })

    const host: ScholarlyReadHost = {
      http: this.http,
      keys: (): ScholarlyKeys => ({
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
      zoteroService: (): ZoteroServiceLike | undefined => ctx.get('zotero'),
    }

    // The tools are registered once, here: they exist exactly as long as this
    // fiber does, because `ctx.tools.register()` is fiber-scoped.
    for (const tool of createAllScholarlyTools(host)) ctx.tools.register(tool)

    // The component owns the policy the model reads about these tools, so the
    // prompt names an external capability only while that capability exists.
    registerScholarlyPromptSection(ctx, () => this.currentConfig)
  }
}

export default ScholarlyService
