// @vitest-environment jsdom
/** The public resource service retains prepared documents across tab body remounts. */
import { createRequire } from 'node:module'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import * as store from '@deepseek-ai/dsh-client-store'
import { expect, it, vi } from 'vitest'
import {
  ParsedDocuments,
  type ParsedDocumentResource,
} from '../../../src/client/parsed-documents.ts'
import { documentRead, ADDRESS } from './support/parsed-document.tsx'
import { observable } from '../enrichment/support/parse-ports.ts'
import { deferred } from '../../helpers/sync.ts'

it('opens once, keeps its Blob while pinned, and releases it after the final holder leaves', async () => {
  const runtime = await SlotTestRuntime.create()
  const ctx = runtime.ctx
  // Supply the shell loader to execute the installed browser bundle unchanged.
  let resources:
    Pick<typeof import('@deepseek-ai/dsh-client-resources/client'), 'apply' | 'inject'> | undefined
  Object.defineProperty(window, '__ModuleLoader__', {
    configurable: true,
    value: {
      load({ factory }: { factory: (require: (name: string) => unknown) => unknown }) {
        resources = factory((name) => {
          if (name === '@deepseek-ai/dsh-client-store') return store
          throw new Error(`Unexpected platform import: ${name}`)
        }) as typeof resources
      },
    },
  })
  // Resolve the public entry physically: this case verifies the emitted loader
  // bundle, while normal jsdom imports use its published production source.
  const bundlePath = createRequire(import.meta.url).resolve(
    '@deepseek-ai/dsh-client-resources/client',
  )
  await import(/* @vite-ignore */ bundlePath)
  if (resources === undefined) throw new Error('Resource bundle did not register')
  await ctx.plugin(resources)
  const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:held')
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const read = documentRead('![held](images/figure.png)', {
    images: [{ name: 'images/figure.png', mediaType: 'image/png', bytes: 4, base64: btoa('png!') }],
  })
  const retired = deferred<void>()
  const documents = new ParsedDocuments(read, () => observable(true), vi.fn(), {
    decode: async () => {},
  })
  const pin = new AbortController()
  let detach: (() => void) | undefined
  const ready = deferred<void>()
  try {
    ctx.resources.register({
      protocol: 'zotero-parsed',
      async *open(address, context) {
        try {
          yield* documents.open(address, context)
        } finally {
          retired.resolve()
        }
      },
    })
    ctx.resources.pin(ADDRESS, pin.signal)
    const source = ctx.resources.source(ADDRESS)
    detach = source.subscribe(() => {
      const value = source.getSnapshot().value as ParsedDocumentResource | undefined
      if (value?.phase === 'ready') ready.resolve()
    })
    await ready.promise
    detach()
    detach = undefined
    expect(read.mock.calls.filter(([request]) => request.op === 'open')).toHaveLength(1)
    expect(revoked).not.toHaveBeenCalled()
    detach = source.subscribe(() => {})
    expect((source.getSnapshot().value as ParsedDocumentResource).document?.text).toContain('held')
    detach()
    detach = undefined
    pin.abort()
    await retired.promise
    expect(revoked).toHaveBeenCalledWith('blob:held')
    expect(source.getSnapshot().status).toBe('loading')
  } finally {
    detach?.()
    pin.abort()
    await runtime.dispose()
    created.mockRestore()
    revoked.mockRestore()
  }
})
