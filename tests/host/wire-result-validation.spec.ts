/** Strict result codecs validate on the same hooks the Gateway calls. */
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { expect, it } from 'vitest'
import { TYPERT_MANIFEST } from '../../src/typert.js'
import { statusView } from '../helpers/status-view.js'

it('refuses malformed status results during Host encode and Client decode', () => {
  const codec = TYPERT_MANIFEST.invocations.find((entry) => entry.method === 'status')!.result
  if (codec.mode !== 'strict') throw new Error('status must use a strict codec')
  expect(codec.encode?.(statusView(), () => null)).toEqual(statusView())
  expect(codec.decode?.(statusView())).toEqual(statusView())
  expect(() => codec.encode?.({ providerId: 1 }, () => null)).toThrow()
  expect(() => codec.decode?.({ providerId: 'local' })).toThrow()
})

it('registers and withdraws every strict invocation type through the real Typert registry', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(TypertRegistry)
    const dispose = ctx.typert.register(TYPERT_MANIFEST)
    const names = new Set<string>()
    for (const invocation of TYPERT_MANIFEST.invocations) {
      const codecs = [
        invocation.result,
        ...invocation.parameters.map((parameter) => parameter.codec),
      ]
      for (const codec of codecs) {
        if (codec.mode !== 'strict') continue
        names.add(codec.typeSymbol)
        expect(ctx.typert.resolve(codec.typeSymbol).schema).toBe(codec.create())
      }
    }
    expect(
      new Set(TYPERT_MANIFEST.schemas.map((entry) => `${TYPERT_MANIFEST.package}#${entry.name}`)),
    ).toEqual(names)
    for (const name of names) {
      const reflected = ctx.typert.toJSONSchema(name, { unrepresentable: 'any' })
      expect(reflected).toHaveProperty('$schema')
    }
    await dispose()
    for (const name of names) expect(() => ctx.typert.resolve(name)).toThrow()
  } finally {
    await ctx.fiber.dispose()
  }
})
