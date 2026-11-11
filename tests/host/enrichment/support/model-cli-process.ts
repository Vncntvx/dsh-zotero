/** Typed IPC ownership for actual installer subprocesses; no installer logic lives here. */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { modelBytes, tinyManifest, tinyModel } from '../../../helpers/semantic-model-bundle.ts'
import { deferred, progress } from '../../../helpers/sync.ts'

export interface CliEvent {
  readonly kind: string
  readonly id: number
  readonly pid: number
  readonly details: Readonly<Record<string, unknown>>
}

export interface CliExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

export interface CliHold {
  readonly kind: string
  readonly at?: number
}

const script = fileURLToPath(
  new URL('../../../../scripts/fetch-semantic-model.mjs', import.meta.url),
)
const boundary = fileURLToPath(new URL('./model-cli-boundary.mjs', import.meta.url))
const repo = fileURLToPath(new URL('../../../../', import.meta.url))

function isEvent(value: unknown): value is CliEvent {
  if (typeof value !== 'object' || value === null) return false
  return (
    'kind' in value &&
    typeof value.kind === 'string' &&
    'id' in value &&
    typeof value.id === 'number' &&
    'pid' in value &&
    typeof value.pid === 'number' &&
    'details' in value &&
    typeof value.details === 'object' &&
    value.details !== null
  )
}

export function startModelCli(
  root: string,
  options: {
    readonly holds?: readonly CliHold[]
    readonly args?: readonly string[]
    readonly id?: string
    /** Positive control for the real public file-lock observer, separate from the CLI. */
    readonly lockProbe?: string
  } = {},
) {
  const target =
    options.lockProbe === undefined
      ? [script, `--dir=${root}`, ...(options.args ?? [])]
      : [
          '--input-type=module',
          '--eval',
          `
        import { withFileLock } from '@deepseek-ai/dsh-atomic-write';
        await withFileLock(process.env.WP4_LOCK_PROBE, async () => {}, { waitMs: 60000 });
      `,
        ]
  const child = spawn(process.execPath, ['--import', boundary, ...target], {
    cwd: repo,
    env: {
      ...process.env,
      WP4_LOCK_PROBE: options.lockProbe,
      WP4_CLI_FIXTURE: JSON.stringify({
        model: tinyModel,
        manifest: tinyManifest(),
        bytes: Object.fromEntries(
          Object.entries(modelBytes).map(([path, bytes]) => [path, bytes.toString()]),
        ),
        closed: join(root, `dispatcher-closed-${options.id ?? 'cli'}`),
        control: { holds: options.holds ?? [] },
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const events: CliEvent[] = []
  const changed = progress()
  const ended = deferred<CliExit>()
  let exited = false
  let stdout = ''
  let stderr = ''
  let failure: Error | undefined
  // Both streams are explicitly configured as pipes; the IPC tuple selects
  // spawn's broader overload, which leaves these handles nullable in its type.
  child.stdout!.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr!.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  child.on('message', (message: unknown) => {
    if (!isEvent(message)) return
    events.push(message)
    changed.notify()
  })
  child.once('error', (error) => {
    failure = error
    changed.notify()
  })
  const watchdog = setTimeout(() => {
    child.kill('SIGKILL')
  }, 8_000)
  child.once('close', (code, signal) => {
    clearTimeout(watchdog)
    exited = true
    ended.resolve({ code, signal, stdout, stderr })
    changed.notify()
  })

  async function until(predicate: (event: CliEvent) => boolean): Promise<CliEvent | undefined> {
    await changed.when(() => events.some(predicate) || exited || failure !== undefined)
    if (failure !== undefined) throw failure
    return events.find(predicate)
  }
  function send(message: object) {
    if (child.connected) child.send(message, () => {})
  }
  return {
    events,
    done: ended.promise,
    closed: () => exited,
    until,
    wait: async (kind: string) => {
      const event = await until((entry) => entry.kind === kind)
      if (event === undefined) throw new Error(`CLI exited before ${kind}: ${stderr}`)
      return event
    },
    release: (event: CliEvent) => {
      send({ command: 'release', id: event.id })
    },
    releaseAll: () => {
      send({ command: 'release-all' })
    },
    signal: (signal: NodeJS.Signals) => child.kill(signal),
    dispose: async () => {
      if (!exited) child.kill('SIGKILL')
      await ended.promise
    },
  }
}

export type ModelCli = ReturnType<typeof startModelCli>
