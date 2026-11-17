/** Per-application mount identities without importing optional component implementations. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'

export type EgressComponent = 'scholarly' | 'enrichment'
const roots = new WeakMap<Context, Map<EgressComponent, string>>()

export function registerComponentEnablement(ctx: Context, component: EgressComponent): void {
  const epochs = roots.get(ctx.root) ?? new Map<EgressComponent, string>()
  roots.set(ctx.root, epochs)
  const epoch = randomUUID()
  epochs.set(component, epoch)
  ctx.effect(() => () => {
    if (epochs.get(component) === epoch) epochs.delete(component)
  })
}

export function componentEnablementsOf(
  ctx: Context,
): Readonly<Partial<Record<EgressComponent, string>>> {
  return Object.fromEntries(roots.get(ctx.root) ?? [])
}
