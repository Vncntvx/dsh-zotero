/**
 * Real client-discovery smoke: proves that a clean install of the packed
 * tarball into a fresh dsh profile makes the web composition serve the
 * plugin's browser bundle — package resolution, `dsh.client` discovery,
 * `exports["./client"]`, tarball contents, and the ClientModuleRegistry —
 * without a browser.
 *
 * Steps: npm pack → temp profile → `dsh plugin add <tarball>` → `dsh web
 * --port 0` → GET / → parse window.__DSH_BOOT__ → assert the dsh-zotero row
 * → GET its bundle URL → assert 200 and the __ModuleLoader__.load handoff →
 * shutdown.
 *
 * Usage: node scripts/discovery-smoke.mjs [--dsh <dsh-binary>] [--profile <dir>]
 * @module scripts/discovery-smoke
 */

import { execFile, spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, openSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argAfter(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

const DSH = argAfter('--dsh') ?? 'dsh'
const HOME = argAfter('--home') ?? mkdtempSync(join(tmpdir(), 'dsh-zotero-home-'))
const PROFILE = 'web' // `dsh web` always boots the web profile
const ENV = { ...process.env, DSH_HOME: HOME }

function packPath() {
  const output = execFileSync('npm', ['pack', '--silent'], { cwd: PACKAGE_DIR, encoding: 'utf8' })
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return resolve(PACKAGE_DIR, lines[lines.length - 1])
}

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`GET ${url} → HTTP ${response.status}`)
  return await response.text()
}

function extractBootGraph(html) {
  const match = /window\.__DSH_BOOT__\s*=\s*(\{[\s\S]*?\})\s*<\//.exec(html)
  if (match === null) throw new Error('index HTML carries no window.__DSH_BOOT__ manifest')
  // The host escapes '<' inside the injected script as '\\u003c' so plugin
  // strings cannot break out of the script element; JSON.parse expects the
  // raw character.
  return JSON.parse(match[1].replaceAll('\\u003c', '<'))
}

async function waitForIndex(port, attempts = 240) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const text = await fetchText(`http://127.0.0.1:${port}/`)
      if (text.includes('__DSH_BOOT__')) return text
    } catch {
      // The server is not listening yet; retry after a short delay.
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 250)
    })
  }
  throw new Error(`dsh web did not serve an index within the probe window on port ${port}`)
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const port = server.address().port
  await new Promise((resolveClose) => {
    server.close(resolveClose)
  })
  return port
}

async function main() {
  const tarball = packPath()
  console.log(`packed: ${tarball}`)
  console.log(`home: ${HOME} (profile ${PROFILE})`)

  await execFileAsync(DSH, ['plugin', '--profile', PROFILE, 'add', tarball], { env: ENV })

  const port = await reservePort()
  const logFd = openSync(join(HOME, 'dsh-web.log'), 'a')
  const child = spawn(DSH, ['web', '--port', String(port)], {
    // Both pipes go to the log file: an undrained pipe deadlocks the child
    // once its boot output exceeds the pipe buffer.
    stdio: ['ignore', logFd, logFd],
    env: ENV,
  })
  const closed = new Promise((resolveClosed) => {
    child.once('exit', resolveClosed)
  })
  try {
    const html = await waitForIndex(port)
    const graph = extractBootGraph(html)
    const entry = graph.entries.find((candidate) => candidate.id === 'dsh-zotero')
    if (entry === undefined) {
      throw new Error(
        `__DSH_BOOT__ has no dsh-zotero row; entries: ${graph.entries.map((row) => row.id).join(', ')}`,
      )
    }
    if (!entry.url.startsWith('/plugins/dsh-zotero/client.js?rev=')) {
      throw new Error(`unexpected bundle url: ${entry.url}`)
    }
    const bundle = await fetchText(`http://127.0.0.1:${port}${entry.url}`)
    if (!bundle.includes('__ModuleLoader__.load')) {
      throw new Error('the served bundle does not carry the __ModuleLoader__.load handoff')
    }
    console.log(`discovery ok: ${entry.url}`)
  } finally {
    child.kill('SIGTERM')
    await closed
  }

  rmSync(tarball, { force: true })
  if (argAfter('--home') === undefined) rmSync(HOME, { recursive: true, force: true })
  console.log('discovery-smoke: passed')
}

main().catch((error) => {
  console.error(`discovery-smoke: FAILED: ${error.message}`)
  process.exitCode = 1
})
