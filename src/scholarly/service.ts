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

import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: brings the `ctx.settings` Context merge into this program.
import type {} from '@deepseek-ai/dsh-settings'
import {
  resolveScholarlyConfig,
  ScholarlyConfigSchema,
  type ResolvedScholarlyConfig,
  type ScholarlyConfig,
} from './config.js'
import { ScholarlyTextStore } from './fulltext/store.js'
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
  static readonly inject = ['tools']

  public readonly http: ScholarlyHttp
  public readonly store: ScholarlyTextStore
  private toolDisposes: Array<() => void> = []

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

    this.reconcileTools(ctx, host)
    ctx.on('loader/volatile-update', () => this.reconcileTools(ctx, host))
  }

  private reconcileTools(ctx: Context, host: ScholarlyReadHost): void {
    for (const dispose of this.toolDisposes) dispose()
    this.toolDisposes = []
    if (!this.currentConfig.enabled) return
    this.toolDisposes = createAllScholarlyTools(host).map((tool) => ctx.tools.register(tool))
  }
}

export default ScholarlyService
