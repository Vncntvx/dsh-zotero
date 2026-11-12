/** WP4/X2: exercise the shipped installer command in a child process. */
import { spawn } from 'node:child_process'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  modelBytes,
  tinyManifest,
  tinyModel,
  writeTinyBundle,
} from '../../helpers/semantic-model-bundle.ts'
import { createModelSandbox } from './support/model-sandbox.ts'

const script = fileURLToPath(new URL('../../../scripts/fetch-semantic-model.mjs', import.meta.url))
const boundary = fileURLToPath(new URL('./support/model-cli-boundary.mjs', import.meta.url))
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const sandbox = createModelSandbox('dsh-cli-installer-')

async function world() {
  const root = await sandbox.root()
  return { root, closed: join(root, 'dispatcher-closed') }
}

async function runCli(root: string, args: string[], fail = false) {
  const closed = join(root, 'dispatcher-closed')
  const child = spawn(process.execPath, ['--import', boundary, script, `--dir=${root}`, ...args], {
    cwd: repo,
    env: {
      ...process.env,
      WP4_CLI_FIXTURE: JSON.stringify({
        model: tinyModel,
        manifest: tinyManifest(),
        bytes: Object.fromEntries(
          Object.entries(modelBytes).map(([path, bytes]) => [path, bytes.toString()]),
        ),
        closed,
        fail,
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  // Bound process cleanup if a regression leaves the command running.
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5_000)
  try {
    return await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code) => resolve({ code, stdout, stderr }))
      },
    )
  } finally {
    clearTimeout(deadline)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
}

afterEach(async () => {
  await sandbox.settle()
})

describe('semantic model CLI installation', () => {
  it('accepts an intact synthetic bundle through the real verify-only command', async () => {
    const { root } = await world()
    await writeTinyBundle(root)

    expect(await runCli(root, ['--verify-only'])).toMatchObject({ code: 0 })
  })

  it.each([
    ['schema', { schema: 1 }],
    ['pooling', { pooling: 'cls' }],
    ['query prefix', { queryPrefix: 'wrong task: ' }],
  ])('rejects a manifest with a different %s through verify-only', async (_name, change) => {
    const { root } = await world()
    await writeTinyBundle(root, { ...tinyManifest(), ...change })

    const result = await runCli(root, ['--verify-only'])
    expect(result.code, result.stderr || result.stdout).toBe(1)
  })

  it('keeps the previous target bytes when a replacement download fails', async () => {
    const { root } = await world()
    const dir = await writeTinyBundle(root)
    const target = join(dir, 'config.json')
    await writeFile(target, 'recoverable previous file')

    const result = await runCli(root, ['--no-proxy'], true)

    expect(result.code, result.stderr).toBe(1)
    expect(await readFile(target, 'utf8')).toBe('recoverable previous file')
  })

  it('does not write through a predictable temp symlink during installation', async () => {
    const { root } = await world()
    const dir = join(root, tinyModel.physicalKey)
    await mkdir(dir)
    const sentinel = join(root, 'sentinel.txt')
    await writeFile(sentinel, 'sentinel')
    await symlink(sentinel, join(dir, 'config.json.hf-mirror.tmp'))

    await runCli(root, ['--no-proxy'])

    expect(await readFile(sentinel, 'utf8')).toBe('sentinel')
  })

  it('closes its proxy dispatcher after installation fails', async () => {
    const { root, closed } = await world()
    const result = await runCli(root, ['--proxy=http://127.0.0.1:9'], true)

    expect(result.code, result.stderr).toBe(1)
    expect(await readFile(closed, 'utf8')).toBe('closed\n')
  })
})
