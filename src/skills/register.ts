import type { Context } from '@deepseek-ai/cordis'
import { skillRegistration, type ResearchSop } from './definition.js'

/** Optional registry: arriving/replaced services rebind with the inject fiber. */
export function registerResearchSkills(ctx: Context, sops: readonly ResearchSop[]): void {
  ctx.inject(['skills'], (host) => {
    for (const sop of sops) host.skills.register(skillRegistration(sop))
  })
}
