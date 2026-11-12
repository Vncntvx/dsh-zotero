/** WP4/D2/D4/X2: real CLI processes, real public file locks, and controlled I/O windows. */
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'

import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { modelBytes, tinyManifest, tinyModel } from '../../helpers/semantic-model-bundle.ts'
import { startModelCli, type ModelCli } from './support/model-cli-process.ts'
import { createModelSandbox } from './support/model-sandbox.ts'

const sandbox = createModelSandbox('dsh-cli-coordinate-')
const processes: ModelCli[] = []

async function world() {
  const root = await sandbox.root()
  return { root, dir: join(root, tinyModel.physicalKey) }
}

function start(root: string, options?: Parameters<typeof startModelCli>[1]) {
  const cli = startModelCli(root, options)
  processes.push(cli)
  return cli
}

async function diskFiles(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true })).sort()
}

async function identities(dir: string) {
  return await Promise.all(
    [...tinyModel.files.map(({ path }) => path), 'manifest.json'].map(async (path) => {
      const info = await stat(join(dir, path))
      return {
        path,
        dev: info.dev,
        ino: info.ino,
        size: info.size,
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
      }
    }),
  )
}

function expectDispatcherReleased(cli: ModelCli) {
  const created = cli.events.filter((event) => event.kind === 'dispatcher-created').length
  expect(cli.events.filter((event) => event.kind === 'dispatcher-closed')).toHaveLength(created)
}

async function expectCommitted(dir: string) {
  expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))).toEqual(tinyManifest())
  for (const file of tinyModel.files) {
    const bytes = await readFile(join(dir, file.path))
    expect(bytes).toEqual(modelBytes[file.path])
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
  }
}

afterEach(async () => {
  await Promise.all(processes.splice(0).map((cli) => cli.dispose()))
  await sandbox.settle()
})

describe('CLI installation writer coordination', () => {
  it('observes actual public lock ownership and cleanup across two processes', async () => {
    const { root } = await world()
    // Positive control for the IPC/lock port, independent of whether the old
    // installer has integrated withFileLock. Both contenders call the actual
    // installed public implementation; neither receives a fabricated lock.
    const lockTarget = join(root, 'lock-port-proof')
    const owner = start(root, { lockProbe: lockTarget, holds: [{ kind: 'lock-acquired' }] })
    const acquired = await owner.wait('lock-acquired')
    const contender = start(root, { lockProbe: lockTarget, holds: [{ kind: 'lock-acquired' }] })
    await contender.wait('lock-wait')
    const record = await readFile(`${lockTarget}.lock`, 'utf8')
    expect(record).toBe(`${acquired.pid}\n`)
    owner.release(acquired)
    expect(await owner.done).toMatchObject({ code: 0, signal: null })
    const next = await contender.wait('lock-acquired')
    expect(await readFile(`${lockTarget}.lock`, 'utf8')).toBe(`${next.pid}\n`)
    contender.release(next)
    expect(await contender.done).toMatchObject({ code: 0, signal: null })
    await expect(stat(`${lockTarget}.lock`)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(root)).toEqual([])
  })

  it('serializes two processes and rechecks the committed bundle before a waiting writer downloads', async () => {
    const { root, dir } = await world()
    await mkdir(dir)
    const sentinel = join(dir, 'user-owned.txt')
    await writeFile(sentinel, 'keep me')
    const owner = start(root, { id: 'owner', holds: [{ kind: 'http-admission' }] })
    const admission = await owner.wait('http-admission')
    const contender = start(root, {
      id: 'contender',
      holds: [{ kind: 'http-admission' }, { kind: 'lock-acquired' }],
    })
    // This waits for an observable boundary, never for guessed quiescence. Old
    // code reaches HTTP directly; corrected code reaches the actual file lock.
    const boundary = await contender.until(
      (event) => event.kind === 'lock-wait' || event.kind === 'http-admission',
    )
    try {
      expect(boundary?.kind, 'a second CLI reached HTTP while the first writer was held').toBe(
        'lock-wait',
      )
      expect(boundary?.details.waitMs).toBe(60_000)
      expect(owner.events.some((event) => event.kind === 'lock-acquired')).toBe(true)
      owner.release(admission)
      const ownerExit = await owner.done
      expect(ownerExit, ownerExit.stderr).toMatchObject({ code: 0, signal: null })
      await expectCommitted(dir)
      const before = await identities(dir)
      const acquired = await contender.wait('lock-acquired')
      expect(owner.events.filter((event) => event.kind === 'http-admission')).toHaveLength(
        tinyModel.files.length,
      )
      expect(contender.events.filter((event) => event.kind === 'http-admission')).toEqual([])
      contender.release(acquired)
      const contenderExit = await contender.done
      expect(contenderExit, contenderExit.stderr).toMatchObject({ code: 0, signal: null })
      expect(contender.events.filter((event) => event.kind === 'http-admission')).toEqual([])
      expect(await identities(dir)).toEqual(before)
      expect(await readFile(sentinel, 'utf8')).toBe('keep me')
      await expectCommitted(dir)
    } finally {
      owner.releaseAll()
      contender.releaseAll()
    }
  })

  it('cancels a process waiting on the real lock without admitting HTTP or disturbing the owner', async () => {
    const { root, dir } = await world()
    const owner = start(root, { id: 'owner', holds: [{ kind: 'http-admission' }] })
    const admission = await owner.wait('http-admission')
    const contender = start(root, { id: 'cancelled', holds: [{ kind: 'http-admission' }] })
    const boundary = await contender.until(
      (event) => event.kind === 'lock-wait' || event.kind === 'http-admission',
    )
    try {
      expect(boundary?.kind).toBe('lock-wait')
      expect(contender.signal('SIGINT')).toBe(true)
      const result = await contender.done
      expect(result.signal, result.stderr).toBeNull()
      expect(result.code, result.stderr).not.toBe(0)
      expect(contender.events.filter((event) => event.kind === 'http-admission')).toEqual([])
      expectDispatcherReleased(contender)
      owner.release(admission)
      const finished = await owner.done
      expect(finished, finished.stderr).toMatchObject({ code: 0, signal: null })
      await expectCommitted(dir)
    } finally {
      owner.releaseAll()
      contender.releaseAll()
    }
  })
})

describe('CLI cancellation and manifest publication', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'drains a partial response and owned staging before exiting on %s',
    async (signal) => {
      const { root, dir } = await world()
      await mkdir(dir)
      const sentinel = join(dir, 'user-owned.txt')
      await writeFile(sentinel, 'keep me')
      const cli = start(root, { holds: [{ kind: 'body-pull', at: 2 }] })
      await cli.wait('body-pull')
      await cli.until((event) => event.kind === 'body-pull' && event.details.held === true)

      expect(cli.signal(signal)).toBe(true)
      const result = await cli.done
      expect(await readFile(sentinel, 'utf8')).toBe('keep me')
      await expect(stat(join(dir, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(cli.events.filter((event) => event.kind === 'http-admission')).toHaveLength(1)
      expectDispatcherReleased(cli)
      expect(result.signal, result.stderr).toBeNull()
      expect(result.code, result.stderr).not.toBe(0)
      const closed = await readFile(join(root, 'dispatcher-closed-cli'), 'utf8').catch(() => '')
      expect(await diskFiles(root)).toEqual(
        [
          tinyModel.physicalKey,
          `${tinyModel.physicalKey}/user-owned.txt`,
          ...(closed === '' ? [] : ['dispatcher-closed-cli']),
        ].sort(),
      )
    },
  )

  it('does not publish a marker when cancellation arrives after the final asset write', async () => {
    const { root, dir } = await world()
    const cli = start(root, { holds: [{ kind: 'last-asset-written' }] })
    const window = await cli.wait('last-asset-written')
    // The checkpoint runs after the real rename but before its promise returns.
    expect(await readFile(String(window.details.path))).toEqual(
      modelBytes['onnx/model_quantized.onnx'],
    )
    expect(cli.signal('SIGINT')).toBe(true)
    const observed = await cli.until((event) => event.kind === 'signal-observed')
    if (observed !== undefined) cli.release(window)
    const result = await cli.done

    await expect(stat(join(dir, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(cli.events.some((event) => event.kind === 'manifest-published')).toBe(false)
    expectDispatcherReleased(cli)
    expect(result.signal, result.stderr).toBeNull()
    expect(result.code, result.stderr).not.toBe(0)
  })

  it('does not follow a manifest symlink planted at the paused write boundary', async () => {
    const { root } = await world()
    const sentinel = join(root, 'commit-sentinel.txt')
    await writeFile(sentinel, 'untouched commit sentinel')
    const cli = start(root, { holds: [{ kind: 'manifest-write' }, { kind: 'manifest-atomic' }] })
    const window = await cli.until(
      (event) => event.kind === 'manifest-write' || event.kind === 'manifest-atomic',
    )
    expect(window).toBeDefined()
    const marker = String(window!.details.path)
    // Both direct write and writeFileAtomic expose their actual filesystem path.
    // A safe installer may reject the link or replace its inode, never its referent.
    await symlink(sentinel, marker)
    cli.release(window!)
    await cli.done

    expect(await readFile(sentinel, 'utf8')).toBe('untouched commit sentinel')
  })

  it('ignores a predictable manifest temp symlink while committing the complete bundle', async () => {
    const { root, dir } = await world()
    const sentinel = join(root, 'commit-sentinel.txt')
    await writeFile(sentinel, 'untouched commit sentinel')
    const cli = start(root, { holds: [{ kind: 'manifest-write' }, { kind: 'manifest-atomic' }] })
    const window = await cli.until(
      (event) => event.kind === 'manifest-write' || event.kind === 'manifest-atomic',
    )
    expect(window).toBeDefined()
    const link = join(dirname(String(window!.details.path)), 'manifest.json.tmp')
    await symlink(sentinel, link)
    cli.release(window!)
    const result = await cli.done

    expect(result, result.stderr).toMatchObject({ code: 0, signal: null })
    expect(await readFile(sentinel, 'utf8')).toBe('untouched commit sentinel')
    // The installer must not unlink a path it did not exclusively create.
    if (link.startsWith(dir + '/')) expect((await lstat(link)).isSymbolicLink()).toBe(true)
    await expectCommitted(dir)
  })
})
