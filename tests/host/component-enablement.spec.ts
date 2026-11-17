/** Component enable epochs follow owned mounts and remain isolated across application roots. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import {
  componentEnablementsOf,
  registerComponentEnablement,
} from '../../src/component-enablement.ts'

it('changes the epoch after a component remount and isolates independent hosts', async () => {
  const first = new Context(),
    second = new Context()
  try {
    const mount = () =>
      first.plugin({
        apply(ctx) {
          registerComponentEnablement(ctx, 'scholarly')
        },
      })
    const initial = mount()
    await initial
    const epoch = componentEnablementsOf(first).scholarly
    expect(epoch).toMatch(/^[a-f0-9-]{36}$/)
    expect(componentEnablementsOf(first.extend({})).scholarly).toBe(epoch)
    expect(componentEnablementsOf(second)).toEqual({})
    await second.plugin({
      apply(ctx) {
        registerComponentEnablement(ctx, 'scholarly')
      },
    })
    expect(componentEnablementsOf(second).scholarly).not.toBe(epoch)
    await initial.dispose()
    expect(componentEnablementsOf(first)).toEqual({})
    await mount()
    expect(componentEnablementsOf(first).scholarly).not.toBe(epoch)
  } finally {
    await first.fiber.dispose()
    await second.fiber.dispose()
  }
})

it('does not remove a replacement epoch when an older mount cleans up', async () => {
  const ctx = new Context()
  try {
    const first = ctx.plugin({
      apply(child) {
        registerComponentEnablement(child, 'enrichment')
      },
    })
    await first
    const second = ctx.plugin({
      apply(child) {
        registerComponentEnablement(child, 'enrichment')
      },
    })
    await second
    const epoch = componentEnablementsOf(ctx).enrichment
    await first.dispose()
    expect(componentEnablementsOf(ctx).enrichment).toBe(epoch)
    await second.dispose()
    expect(componentEnablementsOf(ctx)).toEqual({})
  } finally {
    await ctx.fiber.dispose()
  }
})
