/** WP4/D1: real undici streaming, with the network boundary confined to loopback. */
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'

import { join } from 'node:path'
import { Agent, fetch as undiciFetch } from 'undici'
import { afterEach, describe, expect, it } from 'vitest'
import {
  downloadPinnedFile,
  type DownloadClientDeps,
  type FetchLike,
} from '../../../src/enrichment/model-download-client.ts'
import { modelClient, modelResponse, tinyModel } from '../../helpers/semantic-model-bundle.ts'
import { deferred } from '../../helpers/sync.ts'
import { createModelSandbox } from './support/model-sandbox.ts'

const sandbox = createModelSandbox('dsh-model-stream-')

afterEach(async () => {
  await sandbox.settle()
})

async function tempRoot(): Promise<string> {
  return await sandbox.root()
}

async function loopbackBody(status: number, headers: Record<string, string> = {}) {
  // Larger than undici's unread-response buffers and the socket send buffer.
  const bytes = Buffer.alloc(16 * 1024 * 1024, 0x61)
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'content-length': String(bytes.length), ...headers })
    response.end(bytes)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No loopback port')
  const agents: Agent[] = []
  const bodies = new Map<Agent, { readonly bodyUsed: boolean }>()
  const released: boolean[] = []
  let requests = 0
  const deps: DownloadClientDeps = {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    dispatcher: () => {
      const agent = new Agent()
      agents.push(agent)
      return {
        dispatcher: agent,
        close: async () => {
          released.push(bodies.get(agent)?.bodyUsed === true)
          await agent.close()
        },
      }
    },
    fetch: async (_url, init) => {
      requests += 1
      // The downloader still gates the public source URL. Only this injected
      // network adapter changes the actual destination; no external socket opens.
      const agent = init?.dispatcher as Agent
      const response = await undiciFetch(`http://127.0.0.1:${address.port}/model`, {
        redirect: init?.redirect,
        signal: init?.signal,
        dispatcher: agent,
      })
      bodies.set(agent, response)
      return response
    },
  }
  return {
    bytes,
    deps,
    requests: () => requests,
    released,
    close: async () => {
      await Promise.all(agents.map((agent) => agent.destroy()))
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)))
        server.closeAllConnections()
      })
    },
  }
}

describe('model response consumption scope', () => {
  it('consumes a large real undici response before closing its dispatcher', async () => {
    const dir = await tempRoot()
    const local = await loopbackBody(200)
    const file = {
      path: 'large.onnx',
      bytes: local.bytes.length,
      sha256: createHash('sha256').update(local.bytes).digest('hex'),
    }
    try {
      await expect(
        downloadPinnedFile({
          model: tinyModel,
          file,
          dir,
          sources: ['hf-mirror'],
          // A finite failure deadline bounds the deadlock; no sleep drives the test.
          timeoutMs: 10_000,
          deps: local.deps,
        }),
      ).resolves.toMatchObject({ bytes: file.bytes, sha256: file.sha256 })
      expect(await readFile(join(dir, file.path))).toEqual(local.bytes)
    } finally {
      await local.close()
    }
  }, 30_000)

  it('consumes or cancels a rejected large HTTP body before closing its dispatcher', async () => {
    const dir = await tempRoot()
    const local = await loopbackBody(503)
    try {
      await expect(
        downloadPinnedFile({
          model: tinyModel,
          file: tinyModel.files[0]!,
          dir,
          sources: ['hf-mirror'],
          timeoutMs: 10_000,
          deps: local.deps,
        }),
      ).rejects.toThrow(/HTTP 503/)
      expect(local.requests()).toBe(1)
      expect(local.released).toEqual([true])
    } finally {
      await local.close()
    }
  })

  it('does not contact a mirror or create directories for an already-aborted caller', async () => {
    const dir = join(await tempRoot(), 'must-stay-absent')
    const reason = new Error('caller stopped before admission')
    const controller = new AbortController()
    controller.abort(reason)
    const requested: string[] = []
    const outcome = await downloadPinnedFile({
      model: tinyModel,
      file: tinyModel.files[0]!,
      dir,
      sources: ['hf-mirror', 'huggingface'],
      signal: controller.signal,
      deps: modelClient(async (url) => {
        requested.push(url)
        return modelResponse(url)
      }),
    }).then(
      (value) => value,
      (error: unknown) => error,
    )

    expect(requested).toEqual([])
    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(outcome).toBe(reason)
  })

  it('observes cancellation that arrives while the destination parent is being prepared', async () => {
    const dir = await tempRoot()
    const entered = deferred()
    const resume = deferred()
    const controller = new AbortController()
    const reason = new Error('caller stopped during mkdir')
    const requested: string[] = []
    const client = modelClient(async (url) => {
      requested.push(url)
      return modelResponse(url)
    })
    const { hostDownloadFsDeps } = await import('../../../src/enrichment/model-download-client.ts')
    const task = downloadPinnedFile({
      model: tinyModel,
      file: tinyModel.files[0]!,
      dir,
      sources: ['hf-mirror', 'huggingface'],
      signal: controller.signal,
      deps: {
        ...client,
        fs: {
          ...hostDownloadFsDeps,
          mkdir: async (path) => {
            entered.resolve()
            await resume.promise
            await hostDownloadFsDeps.mkdir(path)
          },
        },
      },
    }).then(
      (value) => value,
      (error: unknown) => error,
    )
    await entered.promise
    controller.abort(reason)
    resume.resolve()

    const outcome = await task
    expect(requested).toEqual([])
    expect(outcome).toBe(reason)
  })

  it('cancels an unused redirect body before releasing its connection', async () => {
    const dir = await tempRoot()
    let bodyFinished = false
    const released: boolean[] = []
    let calls = 0
    const fetch: FetchLike = async (url) => {
      calls += 1
      if (calls > 1) return modelResponse(url)
      return {
        ok: false,
        status: 302,
        headers: {
          get: (name) =>
            name === 'location'
              ? 'https://huggingface.co/test/wp4-tiny/resolve/' +
                tinyModel.revision +
                '/config.json'
              : null,
        },
        body: new ReadableStream({
          cancel() {
            bodyFinished = true
          },
        }),
      }
    }
    await downloadPinnedFile({
      model: tinyModel,
      file: tinyModel.files[0]!,
      dir,
      sources: ['hf-mirror'],
      deps: {
        ...modelClient(fetch),
        dispatcher: () => ({
          dispatcher: {},
          close: async () => {
            released.push(bodyFinished)
          },
        }),
      },
    })

    expect(released[0]).toBe(true)
  })
})
