import type { Context } from '@deepseek-ai/cordis'
import { skillRegistration, type ResearchSop } from './definition.js'

/** Optional registry: arriving/replaced services rebind with the inject fiber. */
export function registerResearchSkills(ctx: Context, sops: readonly ResearchSop[]): void {
  ctx.inject(['skills'], (host) => {
    host.effect(() => {
      const disposers = sops.map((sop) => host.skills.register(skillRegistration(sop)))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'zotero: research skills registration')
  })
}
