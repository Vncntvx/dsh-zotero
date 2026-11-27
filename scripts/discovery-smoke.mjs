/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * Real client-discovery smoke: proves that a clean install of the packed
 * tarball into a fresh dsh profile makes the web composition serve the
 * plugin's browser bundle (package resolution, `dsh.client` discovery,
 * `exports["./client"]`, tarball contents, and the ClientModuleRegistry)
 * without a browser.
 *
 * Steps: npm pack → temp profile → `dsh plugin --profile <name> add <tarball>`
 * → `dsh web --port 0` → read the boot token the CLI prints → exchange it for
 * the page cookie (instance auth gates the composition) → GET /
 * → parse the `globalThis["__DSH_BOOT__"]` manifest → assert the dsh-zotero
 * → assert 200 and the __ModuleLoader__.load handoff → shutdown.
 * The packed install needs no build approval: the dependency tree declares no
 * install script, so the run proves exactly what a user gets.
 *
 * Usage: node scripts/discovery-smoke.mjs [--dsh <dsh-binary>] [--home <dir>]
 * @module scripts/discovery-smoke
 */

import { execFile, execFileSync, spawn } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { resolveHarnessRoot } from './shared/harness-packages.mjs'

/** The plugin id the boot graph must carry, derived from the package manifest. */
const PLUGIN_ID = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name

const execFileAsync = promisify(execFile)

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** @param {string} flag @returns {string | undefined} the following argv entry, when present. */
function argAfter(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

function resolveDsh() {
  const explicit = argAfter('--dsh')
  if (explicit !== undefined) return explicit

  const harnessRoot = resolveHarnessRoot(PACKAGE_DIR)
  const siblingCli = join(harnessRoot, 'apps/cli/lib/bin.js')
  if (existsSync(siblingCli)) {
    return siblingCli
  }
  return 'dsh'
}

const DSH = resolveDsh()
const HOME = argAfter('--home') ?? mkdtempSync(join(tmpdir(), 'dsh-zotero-home-'))
const PROFILE = 'web' // `dsh web` always boots the web profile
const ENV = { ...process.env, DSH_HOME: HOME }
const READER_FIXTURE_TITLE = argAfter('--reader-fixture-title')
const READER_NOTE_FIXTURE_TITLE = argAfter('--reader-note-fixture-title')
const READER_NOTE_EMBEDDED_IMAGE = process.argv.includes('--reader-note-embedded-image')
const READER_NOTES_PAGINATION = process.argv.includes('--reader-notes-pagination')
const READER_SNAPSHOT_FIXTURE_TITLE = argAfter('--reader-snapshot-fixture-title')
const READER_TEXT_ATTACHMENTS = process.argv.includes('--reader-text-attachments')
const READER_SIBLING_PDF_TITLE = argAfter('--reader-sibling-pdf-title')
const READER_PARSED_FIXTURE_DIR = argAfter('--reader-parsed-fixture-dir')
const READER_PARSED_GEOMETRY = process.argv.includes('--reader-parsed-geometry')
const READER_CACHED_REGION_TEXT = process.argv.includes('--reader-cached-region-text')
const READER_RESULT_NOTE_PREVIEW = process.argv.includes('--reader-result-note-preview')
const READER_RESULT_NOTE_WRITE = process.argv.includes('--reader-result-note-write')
const READER_NON_PDF_HISTORY = process.argv.includes('--reader-non-pdf-history')
const READER_CAPTURE_IMAGE = process.argv.includes('--reader-capture-image')
const READER_ZOTERO_BASE_URL = argAfter('--reader-zotero-base-url')
const READER_EVIDENCE_REF = argAfter('--reader-evidence-ref')
const READER_SEMANTIC_MODEL_DIR = argAfter('--reader-semantic-model-dir')
const READER_WRITE_PROBE_REF = argAfter('--reader-write-probe-attachment')
const READER_ANSWER = 'Synthetic citation receipt.'
const READER_APPROVAL_PROMPT = 'Hold a synthetic turn open for the Zotero approval checks.'
const READER_APPROVAL_ANSWER = 'The isolated approval turn is open.'
const READER_NOTE_APPROVAL_PROMPT = 'Hold a synthetic turn open for the linked note approval.'
const READER_NOTE_APPROVAL_ANSWER = 'The isolated note approval turn is open.'
const READER_NOTE_MARKER = 'Synthetic Reader result-note write probe'
const READER_EVIDENCE_PROMPT = 'Retrieve the methods and findings passage from the Reader fixture.'
const READER_EVIDENCE_ANSWER = 'Synthetic evidence receipt.'
const READER_CAPTURE_ANSWER = 'Synthetic PNG received with source provenance.'
const READER_CAPTURE_FAILURE = 'Synthetic image or source provenance missing.'
const READER_ANNOTATION_SUGGESTION = 'A suggested comment on the fixture excerpt.'
const READER_TRANSLATION = '合成文献段落译文。'

/** @param {string[]} args */
async function runDsh(args) {
  const command = dshCommand(args)
  try {
    const result = await execFileAsync(command.command, command.args, {
      env: ENV,
      timeout: 10 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    })
    appendFileSync(join(HOME, 'install.log'), result.stdout + result.stderr)
  } catch (error) {
    const output = /** @type {{ stdout?: string, stderr?: string }} */ (error)
    appendFileSync(join(HOME, 'install.log'), (output.stdout ?? '') + (output.stderr ?? ''))
    throw error
  }
}

/** Verify the exact synthetic attachment and parent allowed by the browser write probes. */
async function readerWriteProbe() {
  if (READER_WRITE_PROBE_REF === undefined) return
  const match =
    /^zotero:\/\/user\/0\/attachment\/([A-Z0-9]{8})\?server=([A-Za-z0-9_-]{1,64})$/.exec(
      READER_WRITE_PROBE_REF,
    )
  if (!match || !READER_ZOTERO_BASE_URL)
    throw new Error('The browser write probe needs a server-qualified attachment')
  const [, key, server] = match
  const base = new URL(READER_ZOTERO_BASE_URL)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
    throw new Error('The browser write probe requires an isolated loopback Zotero profile')
  const items = `${base.href.replace(/\/$/, '')}/users/0/items`
  const get = async (/** @type {string} */ path) => {
    const response = await fetch(`${items}/${path}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok || response.headers.get('Zotero-Server-ID') !== server)
      throw new Error('The browser write probe could not verify the pinned Zotero instance')
    return await response.json()
  }
  const attachment = await get(key)
  if (
    attachment.key !== key ||
    attachment.data?.itemType !== 'attachment' ||
    attachment.data.title !== '[dsh-zotero-reader-probe]' ||
    attachment.data.contentType !== 'application/pdf'
  )
    throw new Error('The browser write probe requires the designated synthetic PDF attachment')
  const annotations = async () => {
    const rows = await get(`${key}/children?itemType=annotation`)
    if (!Array.isArray(rows)) throw new Error('Expected a Zotero annotation listing')
    return rows
  }
  if ((await annotations()).length !== 0)
    throw new Error(
      'The browser write probe requires an empty annotation list. Reconcile prior writes in Zotero.',
    )
  const parentKey = attachment.data.parentItem
  const parentRef = `zotero://user/0/item/${parentKey}?server=${server}`
  if (READER_RESULT_NOTE_WRITE) {
    if (
      !/^[A-Z0-9]{8}$/.test(parentKey) ||
      (await get(parentKey)).data?.title !== READER_FIXTURE_TITLE
    )
      throw new Error('The result-note probe requires the designated synthetic parent')
  }
  return { ref: READER_WRITE_PROBE_REF, key, server, annotations, parentKey, parentRef, get }
}

/** Resolve and import the host entries from the consumer's fresh profile. */
async function verifyInstalledEntries() {
  const installAnchor = DSH.endsWith('.js')
    ? join(dirname(dirname(resolve(DSH))), 'package.json')
    : join(
        execFileSync('npm', ['root', '--global'], { encoding: 'utf8' }).trim(),
        '@deepseek-ai/dsh/package.json',
      )
  const result = await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { createRequire } from 'node:module'
      import { pathToFileURL, fileURLToPath } from 'node:url'
      const installAnchor = ${JSON.stringify(installAnchor)}
      const require = createRequire(installAnchor)
      const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
      const { PluginPackages, createRuntimeResolution, loadProfileDirectory } = await import(
        pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href
      )
      const profile = loadProfileDirectory('dsh', process.cwd(), installAnchor)
      const resolution = await createRuntimeResolution({ installAnchor, profile })
      const ctx = new Context()
      try {
        await ctx.plugin(PluginPackages, { resolution })
        const installed = new URL(import.meta.resolve(${JSON.stringify(PLUGIN_ID)}))
        const transport = new URL('./transport/connections.js', installed)
        const { publicFetch } = await import(transport.href)
        const proxy = import.meta.resolve('@deepseek-ai/dsh-http-proxy')
        const proxyRequire = createRequire(proxy)
        if (publicFetch !== proxyRequire('undici').fetch)
          throw new Error('installed plugin fetch uses a different Undici instance from the Harness proxy')
        console.log('installed proxy and plugin share Undici: ' + proxyRequire.resolve('undici'))
        for (const suffix of ['', '/library', '/scholarly', '/enrichment', '/reader']) {
          const name = ${JSON.stringify(PLUGIN_ID)} + suffix
          const entry = await import(name)
          if (typeof entry.default !== 'function') throw new Error(name + ' lacks a loadable service')
          console.log('installed entry ok: ' + name)
        }
        const { openWorkerEmbedder } = await import(
          new URL('./enrichment/semantic/worker-embedder.js', installed)
        )
        const { semanticModelOf } = await import(new URL('./enrichment-model-catalog.js', installed))
        const missingModel = fileURLToPath(new URL('./__missing_semantic_smoke_model__', installed))
        let missing
        try {
          const worker = await openWorkerEmbedder(
            semanticModelOf('lightweight'), missingModel, undefined, AbortSignal.timeout(10000),
          )
          await worker.dispose()
        } catch (error) {
          if (error?.kind !== 'missing') throw error
          missing = true
        }
        if (!missing) throw new Error('installed semantic Worker did not report the missing model')
        console.log('installed semantic Worker ok: typed missing model from a fresh Worker')
      } finally {
        await ctx.fiber.dispose()
      }`,
    ],
    { cwd: join(HOME, 'profiles', PROFILE), env: ENV, timeout: 60_000 },
  )
  console.log(result.stdout.trim())
}

/** @param {string[]} args @returns {{ command: string, args: string[] }} the spawn plan. */
function dshCommand(args) {
  if (DSH.endsWith('.js')) {
    return { command: process.execPath, args: [DSH, ...args] }
  }
  return { command: DSH, args }
}

function packPath() {
  const output = execFileSync('npm', ['pack', '--silent'], { cwd: PACKAGE_DIR, encoding: 'utf8' })
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return resolve(PACKAGE_DIR, lines[lines.length - 1])
}

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms)
  })
}

/**
 * @param {string} url
 * @param {string | undefined} cookie - the instance cookie, when the probe has one.
 * @returns {Promise<string>} the response body.
 */
async function fetchText(url, cookie) {
  const response = await fetch(url, { headers: cookie === undefined ? {} : { cookie } })
  if (!response.ok) throw new Error(`GET ${url} → HTTP ${response.status}`)
  return await response.text()
}

/**
 * @param {string} html - the served index HTML.
 * @returns {{ entries: { id: string, url: string }[], batches?: { entries?: unknown[] }[] }} the boot manifest rows this smoke reads.
 */
function extractBootGraph(html) {
  // The webserver injects the boot graph as `globalThis["__DSH_BOOT__"] = …`
  // (the `window.` spelling is only a browser-side read alias).
  const match = /globalThis\["__DSH_BOOT__"\]\s*=\s*(\{[\s\S]*?\})\s*<\//.exec(html)
  if (match === null) throw new Error('index HTML carries no __DSH_BOOT__ manifest')
  // The host escapes '<' inside the injected script as '\\u003c' so plugin
  // strings cannot break out of the script element; JSON.parse expects the
  // raw character.
  return JSON.parse(match[1].replaceAll('\\u003c', '<'))
}

/**
 * Poll the boot log for the one-time token the web CLI prints on startup.
 * @param {string} home - the temp dsh home.
 * @param {number} [attempts=240] - poll budget.
 * @returns {Promise<string>} the boot token.
 */
async function waitForBootToken(home, attempts = 240) {
  const logPath = join(home, 'dsh-web.log')
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const match = /token=([A-Za-z0-9_-]+)/.exec(readFileSync(logPath, 'utf8'))
      if (match !== null) return match[1]
    } catch {
      // The log appears with the first boot output; retry until then.
    }
    await sleep(250)
  }
  throw new Error('dsh web printed no boot token within the probe window')
}

/**
 * Exchange the one-time boot token for the page cookie every request carries.
 * @param {number} port - the reserved local port.
 * @param {string} token - the boot token.
 * @returns {Promise<string>} the `name=value` page cookie.
 */
async function exchangeTokenForCookie(port, token) {
  const response = await fetch(`http://127.0.0.1:${port}/?token=${token}`, {
    redirect: 'manual',
  })
  if (response.status !== 303) {
    throw new Error(`the boot token exchange returned HTTP ${response.status}`)
  }
  const [setCookie] = response.headers.getSetCookie()
  if (setCookie === undefined) {
    throw new Error('the boot token exchange set no page cookie')
  }
  return setCookie.split(';')[0]
}

/**
 * @param {number} port - the reserved local port.
 * @param {string} cookie - the instance cookie.
 * @param {number} [attempts=240] - poll budget.
 * @returns {Promise<string>} the served index HTML.
 */
async function waitForIndex(port, cookie, attempts = 240) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const text = await fetchText(`http://127.0.0.1:${port}/`, cookie)
      if (text.includes('__DSH_BOOT__')) return text
    } catch {
      // The server is not listening yet; retry after a short delay.
    }
    await sleep(250)
  }
  throw new Error(`dsh web did not serve an index within the probe window on port ${port}`)
}

/**
 * Resolve after two animation frames: the first lays out, the second paints.
 * @param {import('playwright').Page} page
 */
async function settlePaint(page) {
  await page.evaluate(
    () =>
      new Promise((resolvePaint) =>
        requestAnimationFrame(() => requestAnimationFrame(resolvePaint)),
      ),
  )
}

/**
 * Open a menu from its trigger with the trigger centred in its scroller.
 *
 * A portalled card opens below its anchor when there is room and flips above
 * when there is not. Playwright's own click scrolls a trigger the minimum
 * distance into view, which can leave it on the bottom edge, so the card then
 * depends on that flip; a flipped card's lower rows can sit outside the layout
 * viewport on a runner whose font metrics differ, where `elementFromPoint`
 * resolves nothing. Centring the trigger first gives the card its full height
 * below the anchor, so the probe exercises the composition rather than the
 * host's edge placement. The scroll happens before the click because the host
 * dismisses an open menu on scroll.
 */
/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} trigger - the menu trigger locator.
 */
async function openMenu(page, trigger) {
  await trigger.scrollIntoViewIfNeeded()
  await trigger.evaluate((element) => {
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
  })
  await settlePaint(page)
  await trigger.click()
  await settlePaint(page)
}

/** Layout frames a just-opened menu gets to settle before the hit check gives up. */
const MENU_SETTLE_ATTEMPTS = 5

/** @typedef {{ box: { x: number, y: number, width: number, height: number }, point: { x: number, y: number }, probe: { name: string, at: string } }} MenuMiss */

/**
 * Click an open menu's item at its own centre after proving the point resolves
 * to that item. Playwright's own click scrolls the item into view first, and the
 * host menu closes on scroll to stay anchored, so that scroll dismisses the menu
 * before the click lands. The hit check keeps the direct click honest: it fails
 * when the item is covered or has already been dismissed.
 *
 * A portalled card is placed by CSS anchor positioning after the portal inserts,
 * so the row's first measured position can precede its settled one on a runner
 * that lays out differently. Re-reading the box and re-testing across a few
 * paints lets the placement settle without weakening the check: the point that
 * gets clicked is the one this same attempt proved hittable, and a row that
 * never becomes hittable still fails with the geometry that explains why.
 */
/**
 * @param {import('playwright').Page} page
 * @param {string} name - the menu item's exact label.
 */
async function clickMenuItem(page, name) {
  const item = page.getByRole('menuitem', { name, exact: true })
  /** @type {MenuMiss | undefined} */
  let failure
  for (let attempt = 0; attempt < MENU_SETTLE_ATTEMPTS; attempt += 1) {
    const box = await item.boundingBox()
    if (box === null) throw new Error(`menu item ${name} has no layout box`)
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const probe = await page.evaluate((target) => {
      const element = document.elementFromPoint(target.x, target.y)
      const classes = element?.getAttribute('class')
      return {
        name: element?.closest('[role="menuitem"]')?.textContent?.trim() ?? '',
        at:
          element === null
            ? 'no element'
            : `${element.tagName.toLowerCase()}${classes === null || classes === undefined ? '' : `.${classes.split(/\s+/).join('.')}`}`,
      }
    }, point)
    if (probe.name.includes(name)) {
      await page.mouse.click(point.x, point.y)
      return
    }
    failure = { box, point, probe }
    await settlePaint(page)
  }
  const { box, point, probe } = /** @type {MenuMiss} */ (failure)
  const viewport = page.viewportSize()
  throw new Error(
    `menu item ${name} is not hit-testable at its own centre (` +
      `row ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}; ` +
      `centre ${Math.round(point.x)},${Math.round(point.y)}; ` +
      `viewport ${viewport === null ? 'unknown' : `${viewport.width}x${viewport.height}`}; ` +
      `hit: ${JSON.stringify(probe.name)} from ${probe.at})`,
  )
}

/** @returns {Promise<number>} a free loopback port reserved then released. */
async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', /** @type {() => void} */ (resolveListen))
  })
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port
  await new Promise((resolveClose) => {
    server.close(resolveClose)
  })
  return port
}

/**
 * Pin the composition's Documents directory into the fresh profile, so the
 * harness's first-boot default workspace resolves inside the temp home on
 * every host. Without it the Linux path of the workspace controller resolves
 * the system Documents directory through `xdg-user-dir DOCUMENTS`, which a
 * bare CI runner cannot answer (empty, or $HOME, which the controller
 * refuses) — the composition then boots workspace-less and the session
 * composer never renders the plugin's slot surfaces, so the browser phase
 * would wait forever on a button the composition never had a chance to show.
 * @param {number | undefined} readerModelPort the loopback receipt model port for the Reader fixture.
 */
async function pinDocumentsDirectory(readerModelPort) {
  const documents = join(HOME, 'Documents')
  await mkdir(documents, { recursive: true })
  const patchPath = join(HOME, 'profiles', PROFILE, 'cordis.patch.yml')
  const entries = [
    `- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(documents)}`,
  ]
  if (READER_ZOTERO_BASE_URL !== undefined) {
    entries.push(
      `- id: zotero\n  config:\n    baseUrl: ${JSON.stringify(READER_ZOTERO_BASE_URL)}\n    writeEnabled: ${READER_RESULT_NOTE_PREVIEW}${READER_EVIDENCE_REF === undefined ? '' : '\n    fulltextChunkWords: 4'}`,
      '- id: reader\n  disabled: false',
    )
  }
  if (READER_PARSED_FIXTURE_DIR !== undefined || READER_SEMANTIC_MODEL_DIR !== undefined)
    entries.push(
      [
        '- id: enrichment\n  disabled: false\n  config:',
        ...(READER_PARSED_FIXTURE_DIR === undefined
          ? []
          : [`    outputDir: ${JSON.stringify(resolve(READER_PARSED_FIXTURE_DIR))}`]),
        ...(READER_SEMANTIC_MODEL_DIR === undefined
          ? []
          : [
              '    enableSemanticSearch: true',
              '    semanticModel: lightweight',
              `    semanticModelDir: ${JSON.stringify(resolve(READER_SEMANTIC_MODEL_DIR))}`,
            ]),
      ].join('\n'),
    )
  if (readerModelPort !== undefined) {
    entries.push(
      '- id: agent-default-model\n  config:\n    provider: reader-test\n    model: fixture',
      `- id: llm-pi-ai\n  config:\n    providers:\n      reader-test:\n        api: openai-completions\n        apiKeyEnv: ZOTERO_READER_SMOKE_KEY\n        baseURL: http://127.0.0.1:${readerModelPort}/v1\n        models:\n          - id: fixture\n            contextWindow: 65536\n            maxTokens: 1024\n            input: [text, image]`,
      '- id: session-title-llm\n  disabled: true',
    )
  }
  await writeFile(patchPath, `${entries.join('\n')}\n`)
}

/** Complete a synthetic citation turn over the real Harness transport. */
async function startCitationModel() {
  let captureReceived = false
  const server = createHttpServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    request.setEncoding('utf8')
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.once('end', () => {
      /** @type {{ role: string; content?: unknown }[]} */
      let messages
      try {
        messages = JSON.parse(body).messages
        if (!Array.isArray(messages)) throw new Error('Missing messages')
      } catch {
        response.writeHead(400).end()
        return
      }
      /** @param {unknown} content */
      const textOf = (content) =>
        Array.isArray(content)
          ? content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
          : String(content ?? '')
      const last = messages.at(-1)
      const lastContent = JSON.stringify(last?.content ?? '')
      const lastText = textOf(last?.content)
      // The one-shot capture probe checks the same user message for both the
      // source and the image. Harness may append reminders after that message.
      const capture =
        READER_CAPTURE_IMAGE &&
        !captureReceived &&
        messages.find(({ role, content }) => {
          if (role !== 'user') return false
          const text = textOf(content)
          return (
            text.includes('"sourceType":"screenshot"') && !text.includes('"documentType":"parsed"')
          )
        })
      const suggestion = messages.some(
        ({ role, content }) =>
          role === 'system' &&
          String(content).includes('Write a concise research annotation comment'),
      )
      const translation = messages.some(
        ({ role, content }) =>
          role === 'system' &&
          String(content).includes('Translate the supplied excerpt into Chinese.'),
      )
      const holdNoteTurn =
        READER_RESULT_NOTE_WRITE &&
        last?.role === 'user' &&
        lastContent.includes(READER_NOTE_APPROVAL_PROMPT)
      const holdTurn =
        holdNoteTurn ||
        (READER_RESULT_NOTE_PREVIEW &&
          last?.role === 'user' &&
          lastContent.includes(READER_APPROVAL_PROMPT))
      const captureContent = capture ? JSON.stringify(capture.content ?? '') : ''
      if (capture) captureReceived = true
      const answer = capture
        ? captureContent.includes('data:image/png;base64,iVBORw0KGgo') &&
          captureContent.includes('attachmentRef') &&
          captureContent.includes('sha256:')
          ? READER_CAPTURE_ANSWER
          : READER_CAPTURE_FAILURE
        : holdTurn
          ? holdNoteTurn
            ? READER_NOTE_APPROVAL_ANSWER
            : lastText.includes(READER_TRANSLATION) &&
                lastText.includes('"attachmentRef":') &&
                lastText.includes('"translation":{"target":"zh","engine":"model"}')
              ? READER_APPROVAL_ANSWER
              : 'Synthetic translation provenance missing.'
          : suggestion
            ? READER_ANNOTATION_SUGGESTION
            : translation
              ? READER_TRANSLATION
              : last?.role === 'tool'
                ? READER_SEMANTIC_MODEL_DIR === undefined ||
                  /meaning only|query words and meaning/.test(lastContent)
                  ? READER_EVIDENCE_ANSWER
                  : 'Synthetic evidence receipt lacked a semantic match.'
                : READER_ANSWER
      const retrieve =
        READER_EVIDENCE_REF !== undefined &&
        last?.role === 'user' &&
        lastContent.includes(READER_EVIDENCE_PROMPT)
      const calls = retrieve
        ? [
            {
              index: 0,
              id: 'call_reader_evidence',
              type: 'function',
              function: {
                name: 'zotero_retrieve',
                arguments: JSON.stringify({
                  mode: 'evidence',
                  ref: READER_EVIDENCE_REF,
                  query:
                    READER_SEMANTIC_MODEL_DIR === undefined
                      ? 'Methods findings'
                      : 'Methods and findings',
                  sources: ['fulltext'],
                  passages: 1,
                }),
              },
            },
          ]
        : undefined
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const [delta, finish_reason] of [
        [
          calls
            ? { role: 'assistant', tool_calls: calls }
            : {
                role: 'assistant',
                content: answer,
              },
          null,
        ],
        [{}, calls ? 'tool_calls' : 'stop'],
      ]) {
        response.write(
          `data: ${JSON.stringify({ id: 'reader-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        )
        if (holdTurn) {
          const ceiling = setTimeout(
            () => response.end('data: [DONE]\n\n'),
            READER_WRITE_PROBE_REF === undefined ? 30_000 : 180_000,
          )
          response.once('close', () => clearTimeout(ceiling))
          return
        }
      }
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveListen(undefined))
  })
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
  return { port, close: () => server.close() }
}

/**
 * Initialize the profile. `version-exemptions` is a DSH-owned command: it
 * initializes the profile without installing anything or touching the network,
 * and the harness writes its own `pnpm-workspace.yaml` template (hoisted
 * linker, no automatic peers) when the file is absent.
 */
async function initializeProfile() {
  await mkdir(HOME, { recursive: true })
  await runDsh(['plugin', '--profile', PROFILE, 'version-exemptions'])
}

async function main() {
  if (READER_WRITE_PROBE_REF !== undefined && !READER_RESULT_NOTE_PREVIEW)
    throw new Error('The browser write probe requires --reader-result-note-preview')
  if (READER_RESULT_NOTE_WRITE && READER_WRITE_PROBE_REF === undefined)
    throw new Error('The result-note write probe requires --reader-write-probe-attachment')
  if (
    (READER_FIXTURE_TITLE === undefined) !== (READER_ZOTERO_BASE_URL === undefined) ||
    ((READER_EVIDENCE_REF !== undefined ||
      READER_NOTE_FIXTURE_TITLE !== undefined ||
      READER_NOTES_PAGINATION ||
      READER_SNAPSHOT_FIXTURE_TITLE !== undefined ||
      READER_SIBLING_PDF_TITLE !== undefined ||
      READER_RESULT_NOTE_PREVIEW ||
      READER_CAPTURE_IMAGE ||
      READER_PARSED_FIXTURE_DIR !== undefined) &&
      READER_FIXTURE_TITLE === undefined) ||
    (READER_PARSED_GEOMETRY && READER_PARSED_FIXTURE_DIR === undefined) ||
    (READER_CACHED_REGION_TEXT && !READER_PARSED_GEOMETRY) ||
    (READER_NOTE_EMBEDDED_IMAGE && !READER_NOTE_FIXTURE_TITLE) ||
    (READER_TEXT_ATTACHMENTS && !READER_SNAPSHOT_FIXTURE_TITLE) ||
    (READER_NON_PDF_HISTORY && (!READER_NOTE_FIXTURE_TITLE || !READER_SNAPSHOT_FIXTURE_TITLE)) ||
    (READER_FIXTURE_TITLE !== undefined && !process.argv.includes('--browser'))
  )
    throw new Error(
      'Reader acceptance needs --browser, an isolated Zotero URL, and a fixture title',
    )
  const suppliedTarball = argAfter('--tarball')
  const tarball = suppliedTarball === undefined ? packPath() : resolve(suppliedTarball)
  console.log(`packed: ${tarball}`)
  console.log(`home: ${HOME} (profile ${PROFILE})`)

  await initializeProfile()

  await runDsh(['plugin', '--profile', PROFILE, 'add', tarball])
  await verifyInstalledEntries()
  const citationModel = READER_FIXTURE_TITLE === undefined ? undefined : await startCitationModel()
  try {
    if (!process.argv.includes('--install-only')) await pinDocumentsDirectory(citationModel?.port)

    // The reserved port can be stolen between reserve and bind; retry the whole
    // serve on EADDRINUSE instead of failing the run on a TOCTOU loss.
    for (let attempt = 1; !process.argv.includes('--install-only') && attempt <= 3; attempt += 1) {
      try {
        await serveOnce(await reservePort())
        break
      } catch (error) {
        if (/** @type {{ code?: string }} */ (error)?.code !== 'EADDRINUSE' || attempt === 3)
          throw error
        console.log(`port stolen (attempt ${attempt}); retrying on a fresh port`)
      }
    }
  } finally {
    citationModel?.close()
  }

  try {
    if (suppliedTarball === undefined) rmSync(tarball, { force: true })
    if (argAfter('--home') === undefined) rmSync(HOME, { recursive: true, force: true })
  } catch {
    // Best effort cleanup: a failed smoke run must not mask its own error.
  }
  console.log('discovery-smoke: passed')
}

/** @param {number} port - the reserved local port to bind. */
async function serveOnce(port) {
  const logPath = join(HOME, 'dsh-web.log')
  const logFd = openSync(logPath, 'a')
  const web = dshCommand(['web', '--port', String(port), '--no-open'])
  const child = spawn(web.command, web.args, {
    // Both pipes go to the log file: an undrained pipe deadlocks the child
    // once its boot output exceeds the pipe buffer.
    stdio: ['ignore', logFd, logFd],
    env:
      READER_FIXTURE_TITLE === undefined
        ? ENV
        : { ...ENV, ZOTERO_READER_SMOKE_KEY: 'synthetic-fixture' },
  })
  const closed = new Promise((resolveClosed, rejectClosed) => {
    child.once('exit', resolveClosed)
    child.once('error', rejectClosed)
  })
  try {
    // The web CLI authenticates the composition behind a per-instance
    // token: the log carries the one-time token, the 303 exchanges it for the
    // page cookie, and every probe below rides that cookie.
    const token = await waitForBootToken(HOME)
    const cookie = await exchangeTokenForCookie(port, token)
    const html = await waitForIndex(port, cookie)
    const graph = extractBootGraph(html)
    const entry = graph.entries.find((candidate) => candidate.id === PLUGIN_ID)
    if (entry === undefined) {
      throw new Error(
        `__DSH_BOOT__ has no ${PLUGIN_ID} row; entries: ${graph.entries.map((row) => row.id).join(', ')}`,
      )
    }
    // The boot graph composes content-addressed combo scripts: every
    // entry row carries the revisioned single-resource combo URL, and its id
    // must appear in a scheduling batch.
    if (!entry.url.replace(/^\//, '').startsWith(`plugins/??${PLUGIN_ID}/client.js&rev=`)) {
      throw new Error(`unexpected bundle url: ${entry.url}`)
    }
    if (
      !Array.isArray(graph.batches) ||
      !graph.batches.some(
        (batch) => Array.isArray(batch.entries) && batch.entries.includes(PLUGIN_ID),
      )
    ) {
      throw new Error(`__DSH_BOOT__ schedules no batch entry for ${PLUGIN_ID}`)
    }
    const baseUrl = new URL(`http://127.0.0.1:${port}/`)
    const bundleUrl = new URL(entry.url, baseUrl)
    if (bundleUrl.origin !== baseUrl.origin) {
      throw new Error(`bundle url leaves the local server: ${entry.url}`)
    }
    const bundle = await fetchText(bundleUrl.href, cookie)
    if (!bundle.includes('__ModuleLoader__.load')) {
      throw new Error('the served bundle does not carry the __ModuleLoader__.load handoff')
    }
    if (process.argv.includes('--browser')) {
      await verifyBrowser(port, cookie)
      const reader = await execFileAsync(
        process.execPath,
        [
          join(PACKAGE_DIR, 'scripts', 'smoke-reader-pdf.mjs'),
          join(HOME, 'profiles', PROFILE, 'node_modules', PLUGIN_ID, 'lib', 'client.reader-pdf.js'),
        ],
        { env: ENV, timeout: 120_000 },
      )
      console.log(reader.stdout.trim())
    }
    console.log(`discovery ok: ${entry.url}`)
  } finally {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    } catch {
      // The child already failed to spawn; `closed` below carries the error.
    }
    try {
      await closed
    } finally {
      try {
        closeSync(logFd)
      } catch {
        // Best effort: the log fd must not leak even when the child failed.
      }
    }
  }
  // Attribute a dead child: a stolen port reads as EADDRINUSE in the log and
  // retries on a fresh port; anything else fails the run as-is.
  if (child.exitCode !== null && child.exitCode !== 0) {
    let log = ''
    try {
      log = readFileSync(logPath, 'utf8')
    } catch {
      // No log to attribute with; fall through to the generic failure below.
    }
    if (log.includes('EADDRINUSE')) {
      const stolen = /** @type {Error & { code: string }} */ (
        new Error(`dsh web could not bind port ${port} (EADDRINUSE)`)
      )
      stolen.code = 'EADDRINUSE'
      throw stolen
    }
    throw new Error(`dsh web exited with code ${child.exitCode} before serving`)
  }
}

/**
 * @param {number} port - the reserved local port.
 * @param {string} cookie - the instance cookie.
 */
async function verifyBrowser(port, cookie) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_EXECUTABLE,
  })
  const browserContext = await browser.newContext({ locale: 'en-US' })
  if (READER_FIXTURE_TITLE !== undefined)
    await browserContext.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: `http://127.0.0.1:${port}`,
    })
  const [cookieName, ...cookieParts] = cookie.split('=')
  await browserContext.addCookies([
    {
      name: cookieName,
      value: cookieParts.join('='),
      domain: '127.0.0.1',
      path: '/',
    },
  ])
  const page = await browserContext.newPage()
  /** @type {string[]} */
  const pageErrors = []
  /** @type {string[]} */
  const requests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => requests.push(request.url()))
  const assertZoteroStyles = async () => {
    await page.locator('[data-zotero-config-page]').waitFor()
    const styles = await page.evaluate((id) => {
      const settings = document.querySelector('[data-zotero-config-page]')
      if (!settings) throw new Error('Zotero settings are missing')
      const css = getComputedStyle(settings)
      const owned = document.querySelectorAll(
        `style[data-plugin="${id}"][data-path="src/client/ZoteroSettingsSection.module.css"]`,
      )
      return {
        owned: owned.length === 1,
        display: css.display,
        direction: css.flexDirection,
      }
    }, PLUGIN_ID)
    if (!styles.owned || styles.display !== 'flex' || styles.direction !== 'column')
      throw new Error(
        `browser did not apply the Zotero settings stylesheet: ${JSON.stringify(styles)}`,
      )
  }
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
    const welcome = page.getByRole('button', { name: 'Continue', exact: true })
    const onboarding = page.getByRole('dialog', { name: 'Get started', exact: true })
    const panel = page.getByRole('button', { name: 'Literature panel', exact: true })
    try {
      await welcome.click({ timeout: 15_000 })
      await onboarding.or(panel).first().waitFor({ timeout: 15_000 })
      if (await onboarding.isVisible()) {
        await onboarding.getByRole('button', { name: 'Close', exact: true }).click()
      }
      await panel.waitFor({ timeout: 15_000 })
    } catch (error) {
      const body = await page
        .locator('body')
        .innerText()
        .catch(() => '')
      throw new Error(
        `${/** @type {Error} */ (error).message}; body=${body.slice(0, 500)}; pageErrors=${pageErrors.join('|')}`,
      )
    }
    if ((await panel.count()) !== 1) {
      throw new Error(
        'the browser registered an unexpected number of Zotero literature panel controls',
      )
    }
    if (READER_PARSED_FIXTURE_DIR !== undefined) {
      const disclosure = page.getByRole('dialog', { name: 'Document parsing is enabled' })
      await disclosure.getByRole('button', { name: 'Got it', exact: true }).click()
    }
    await panel.click()
    if (!requests.some((url) => url.includes('dsh-zotero/client.js'))) {
      throw new Error(
        `the browser never requested the packed dsh-zotero client bundle: ${requests.filter((url) => url.includes('plugin') || url.includes('client')).join(' | ')}`,
      )
    }
    if (pageErrors.length > 0) {
      throw new Error(`browser page errors: ${pageErrors.join('; ')}`)
    }
    if (READER_FIXTURE_TITLE !== undefined) {
      try {
        if (READER_RESULT_NOTE_PREVIEW && (!READER_CAPTURE_IMAGE || READER_NOTE_EMBEDDED_IMAGE)) {
          await page
            .locator('[contenteditable="true"]:visible')
            .fill('Start the synthetic Reader session.')
          await page.getByRole('button', { name: 'Send message', exact: true }).click()
          await page.getByText(READER_ANSWER, { exact: true }).waitFor()
          await page
            .getByRole('button', { name: 'Stop generating', exact: true })
            .waitFor({ state: 'hidden' })
        }
        if (READER_NOTE_FIXTURE_TITLE !== undefined)
          await verifyReaderNote(page, READER_NOTE_FIXTURE_TITLE)
        if (READER_SNAPSHOT_FIXTURE_TITLE !== undefined)
          await verifyReaderSnapshot(page, READER_SNAPSHOT_FIXTURE_TITLE)
        if (READER_NON_PDF_HISTORY && READER_NOTE_FIXTURE_TITLE && READER_SNAPSHOT_FIXTURE_TITLE)
          await verifyNonPdfHistory(page, READER_NOTE_FIXTURE_TITLE)
        await verifyReaderFlow(page, READER_FIXTURE_TITLE)
      } catch (error) {
        await page.screenshot({ path: join(HOME, 'reader-flow-failure.png') }).catch(() => {})
        throw error
      }
    }
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    await page
      .locator('[data-plugin-package="dsh-zotero"]')
      .getByRole('button', { name: /^View / })
      .click()
    await page.locator('[data-plugin-detail="dsh-zotero"]').waitFor()
    if (
      await page
        .getByRole('tabpanel', { name: 'General', exact: true })
        .getByLabel('Default citation style', { exact: true })
        .count()
    )
      throw new Error('Citation defaults still appear in General settings')
    const settings = page.locator('[data-zotero-config-page]')
    await settings.getByRole('tab', { name: 'Library', exact: true }).click()
    await page.getByRole('button', { name: 'List density', exact: true }).waitFor()
    await assertZoteroStyles()
    for (const name of [
      'Display and details',
      'Browsing',
      'PDF reading',
      'Citations and conversation',
      'Citation defaults',
    ])
      await settings.getByRole('region', { name, exact: true }).waitFor()
    if (
      await settings
        .getByText(/Appearance preview|Edit citation defaults in General|恢复继承设置/)
        .count()
    )
      throw new Error('Removed preview, navigation or global reset controls are still present')
    await openMenu(page, settings.getByRole('button', { name: 'List density', exact: true }))
    await clickMenuItem(page, 'Compact')
    if (
      !(
        await settings.getByRole('button', { name: 'List density', exact: true }).innerText()
      ).includes('Compact')
    )
      throw new Error('List density draft did not update')
    const libraryPanel = settings.getByRole('tabpanel', { name: 'Library', exact: true })
    const save = libraryPanel.getByRole('button', { name: 'Save', exact: true })
    if (!(await save.isEnabled())) throw new Error('The staged appearance edit cannot be saved')
    await save.click()
    await libraryPanel.getByRole('button', { name: 'Save', exact: true }).waitFor()
    if (await libraryPanel.getByRole('button', { name: 'Save', exact: true }).isEnabled())
      throw new Error('The settings save did not settle as accepted')
    const citation = settings.getByRole('region', { name: 'Citation defaults', exact: true })
    await citation.getByLabel('Default citation style', { exact: true }).fill('vancouver')
    await citation.getByLabel('Default citation locale', { exact: true }).fill('zh-CN')
    await save.click()
    await libraryPanel.getByRole('button', { name: 'Save', exact: true }).waitFor()
    if (await libraryPanel.getByRole('button', { name: 'Save', exact: true }).isEnabled())
      throw new Error('Direct citation-default edits were not accepted')
    await page.reload({ waitUntil: 'domcontentloaded' })
    const plugins = page.getByRole('button', { name: 'Plugins', exact: true })
    await onboarding.or(plugins).first().waitFor()
    if (await onboarding.isVisible()) {
      await onboarding.getByRole('button', { name: 'Close', exact: true }).click()
    }
    await plugins.click()
    await page
      .locator('[data-plugin-package="dsh-zotero"]')
      .getByRole('button', { name: /^View / })
      .click()
    await page
      .locator('[data-zotero-config-page]')
      .getByRole('tab', { name: 'Library', exact: true })
      .click()
    const acceptedDensity = page
      .locator('[data-zotero-config-page]')
      .getByRole('button', { name: 'List density', exact: true })
    await acceptedDensity.waitFor()
    await assertZoteroStyles()
    if (!(await acceptedDensity.innerText()).includes('Compact'))
      throw new Error('Saved density was not restored from the host after browser reload')
    if (
      (await citation.getByLabel('Default citation style', { exact: true }).inputValue()) !==
        'vancouver' ||
      (await citation.getByLabel('Default citation locale', { exact: true }).inputValue()) !==
        'zh-CN'
    )
      throw new Error('Saved citation defaults were not restored after browser reload')
    await page
      .getByRole('region', { name: 'Display and details', exact: true })
      .scrollIntoViewIfNeeded()
    const waitForPaint = () =>
      page.evaluate(async () => {
        await document.fonts.ready
        await new Promise((resolvePaint) =>
          requestAnimationFrame(() => requestAnimationFrame(resolvePaint)),
        )
      })
    await waitForPaint()
    await page.screenshot({
      path: join(HOME, 'zotero-library-settings.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await citation.scrollIntoViewIfNeeded()
    await waitForPaint()
    await page.screenshot({
      path: join(HOME, 'zotero-library-citation-defaults.png'),
      fullPage: true,
      animations: 'disabled',
    })
    console.log(
      'browser settings ok: five groups, direct citation editors, accepted saves and reload persistence',
    )
    if (pageErrors.length > 0) throw new Error(`browser page errors: ${pageErrors.join('; ')}`)
    console.log('browser composition ok: packed bundle and literature panel surface')
  } finally {
    await browserContext.close()
    await browser.close()
  }
}

/** @param {import('playwright').Page} page @param {string} title */
async function verifyReaderNote(page, title) {
  const itemsTab = page.getByRole('tab', { name: 'Items', exact: true })
  const narrow = await itemsTab.isVisible()
  if (narrow) await itemsTab.click()
  await page.getByText(title, { exact: true }).filter({ visible: true }).first().click()
  if (narrow) {
    const inspectorTab = page.getByRole('tab', { name: 'Inspector', exact: true })
    if ((await inspectorTab.getAttribute('aria-selected')) !== 'true') await inspectorTab.click()
  }
  await page.getByRole('button', { name: 'Open note in Reader', exact: true }).click()
  const note = page.getByRole('article', { name: title, exact: true })
  await note.getByRole('heading', { name: title, exact: true }).first().waitFor()
  if (READER_NOTE_EMBEDDED_IMAGE) {
    if (await note.locator('img').count()) throw new Error('Note loaded an image before request')
    await note.getByRole('button', { name: 'Show note image · Synthetic note figure' }).click()
    const figure = note.getByRole('img', { name: 'Synthetic note figure' })
    await figure.evaluate(async (image) => {
      if (!(image instanceof HTMLImageElement) || !image.src.startsWith('blob:'))
        throw new Error('Note figure was not read as a local blob')
      await image.decode()
      if (image.naturalWidth !== 32 || image.naturalHeight !== 12)
        throw new Error('Note figure did not decode with the fixture dimensions')
    })
    if ((await note.locator('img').count()) !== 1) throw new Error('Note mounted an external image')
    console.log('browser reader ok: Zotero note loads its embedded PNG on demand')
    if (READER_RESULT_NOTE_PREVIEW) {
      const firstParagraph = note.locator('p', { hasText: title }).first()
      await selectReaderText(firstParagraph)
      await note.getByRole('button', { name: 'Create excerpt image', exact: true }).click()
      const capture = note.getByRole('region', { name: 'Create excerpt image', exact: true })
      await verifyExcerptImage(capture)
      await capture.getByRole('button', { name: 'Cancel', exact: true }).click()
      await note.evaluate((element) => {
        element.ownerDocument.getSelection()?.removeAllRanges()
        element.ownerDocument.dispatchEvent(new Event('selectionchange'))
      })
      console.log('browser reader ok: standalone note selection generates an excerpt PNG')
      const edit = note.getByRole('button', { name: 'Edit text', exact: true })
      const editor = page.getByRole('form', { name: 'Edit text', exact: true })
      const text = editor.getByRole('textbox', { name: 'Text 1', exact: true })
      const sample = 'Synthetic edit for the idle approval check.'
      await edit.click()
      await text.fill(sample)
      await text.evaluate((field) => {
        if (!(field instanceof HTMLTextAreaElement)) throw new Error('Expected a note text area')
        field.focus()
        field.setSelectionRange(10, 14)
      })
      await editor
        .getByRole('combobox', { name: 'Formatting for text 1', exact: true })
        .selectOption('em')
      const formatting = editor
        .getByRole('group', { name: 'Formatting preview for text 1', exact: true })
        .locator('em')
      if ((await formatting.textContent()) !== 'edit')
        throw new Error('The note draft did not apply formatting to the selected word')
      await editor.getByRole('button', { name: 'Save note', exact: true }).click()
      await editor.getByText(/Zotero write approval requires an active conversation turn/).waitFor()
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
      await edit.click()
      if ((await text.inputValue()) !== sample || !(await text.isEditable()))
        throw new Error('Idle approval refusal did not leave the note draft editable')
      if ((await formatting.textContent()) !== 'edit')
        throw new Error('The reopened draft did not retain the selected word formatting')
      await editor.getByRole('button', { name: 'Discard draft', exact: true }).click()
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
      console.log(
        'browser reader ok: idle note approval refusal preserves the selected formatting draft',
      )

      await page.evaluate(() => {
        const original = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {
          if (this === sessionStorage && key.startsWith('dsh-zotero:reader:note-draft:v1:'))
            throw new DOMException('Synthetic draft quota', 'QuotaExceededError')
          return original.call(this, key, value)
        }
        window.addEventListener(
          'reader-smoke-restore-draft-storage',
          () => {
            Storage.prototype.setItem = original
          },
          { once: true },
        )
      })
      try {
        await edit.click()
        await text.fill(sample)
        await editor.getByText('Draft kept until this browser tab reloads or closes.').waitFor()
        await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
        await edit.click()
        if ((await text.inputValue()) !== sample)
          throw new Error('Storage quota failure did not preserve the local note draft')
        await editor.getByRole('button', { name: 'Discard draft', exact: true }).click()
        await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
        console.log(
          'browser reader ok: recover and discard a note draft after storage quota failure',
        )
      } finally {
        await page.evaluate(() =>
          window.dispatchEvent(new Event('reader-smoke-restore-draft-storage')),
        )
      }
    }
  }
  if (READER_NON_PDF_HISTORY)
    await note.getByRole('button', { name: 'Quote in chat', exact: true }).click()
  await page
    .locator('[data-sidebar-right-session] [role="tab"][aria-selected="true"]')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await note.waitFor({ state: 'hidden' })
  if (narrow) await itemsTab.click()
  console.log('browser reader ok: standalone Zotero note opens from Library')
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} reader
 */
async function verifyReaderNotesPagination(page, reader) {
  const toggle = reader.getByRole('button', { name: 'Document details', exact: true })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  const panel = reader.getByRole('complementary', { name: 'Document details', exact: true })
  const notes = panel.getByRole('button', { name: 'Open note', exact: true })
  const previews = panel
    .getByRole('paragraph')
    .filter({ hasText: /^Synthetic pagination note \d+$/ })
  const loadMore = panel.getByRole('button', { name: 'Load more notes', exact: true })
  await loadMore.waitFor()
  if ((await notes.count()) !== 50) throw new Error('Expected 50 notes in the first page')
  await panel.getByText('Quote multiple notes', { exact: true }).click()
  const first = await previews.first().innerText()
  const firstChoice = panel.getByRole('checkbox', { name: first, exact: true })
  await firstChoice.check()
  const start = Date.now()
  await loadMore.click()
  await notes.nth(74).waitFor({ state: 'attached' })
  const elapsedMs = Date.now() - start
  if ((await notes.count()) !== 75 || (await loadMore.count()) !== 0)
    throw new Error('Expected 75 accumulated note rows and no continuation')
  if (!(await firstChoice.isChecked())) throw new Error('Note selection was lost across pages')
  const last = await previews.last().innerText()
  await panel.getByRole('checkbox', { name: last, exact: true }).check()
  await panel.getByRole('button', { name: 'Add citation to draft', exact: true }).click()
  const quote = page.locator('[data-composer-quote]').filter({ hasText: 'Quote multiple notes' })
  await quote.waitFor()
  const excerpt = await quote.textContent()
  if (!excerpt?.includes(first) || !excerpt.includes(last))
    throw new Error('Composer quote did not include both note excerpts')
  await notes.last().click()
  await reader.getByRole('article', { name: last, exact: true }).getByText(last).waitFor()
  await reader.getByRole('button', { name: 'Back to details', exact: true }).click()
  await toggle.click()
  console.log(
    `browser reader ok: 75 linked notes, second page in ${elapsedMs} ms, cross-page citation and note open`,
  )
}

/** @param {import('playwright').Locator} locator */
async function selectReaderText(locator) {
  await locator.evaluate((element) => {
    const range = element.ownerDocument.createRange()
    range.selectNodeContents(element)
    const selection = element.ownerDocument.getSelection()
    if (!selection) throw new Error('Reader text selection is unavailable')
    selection.removeAllRanges()
    element.ownerDocument.dispatchEvent(new Event('selectionchange'))
    selection.addRange(range)
    element.ownerDocument.dispatchEvent(new Event('selectionchange'))
  })
}

/** @param {import('playwright').Locator} capture */
async function verifyExcerptImage(capture) {
  const preview = capture.getByRole('img', { name: 'Excerpt image preview', exact: true })
  const result = await preview.evaluate(async (element) => {
    const image = /** @type {HTMLImageElement} */ (element)
    await image.decode()
    const canvas = element.ownerDocument.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable for validating the excerpt')
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let index = 4; index < data.length; index += 4) {
      if (data[index] !== data[0]) return { width: canvas.width, height: canvas.height, ink: true }
    }
    return { width: canvas.width, height: canvas.height, ink: false }
  })
  if (
    result.width < 16 ||
    result.width > 400 ||
    result.height < 12 ||
    result.height > 100 ||
    !result.ink
  )
    throw new Error(
      `Reader excerpt did not retain the selected region dimensions and text: ${JSON.stringify(result)}`,
    )
  if (
    await capture
      .getByText('This preview shows the selected text in a standard layout.')
      .isVisible()
  )
    throw new Error('Reader unexpectedly switched to the standard excerpt layout')
}

/** @param {import('playwright').Page} page @param {string} title */
async function verifyReaderSnapshot(page, title) {
  await page.getByRole('searchbox', { name: 'Search titles, creators, years…' }).waitFor()
  const itemsTab = page.getByRole('tab', { name: 'Items', exact: true })
  const narrow = await itemsTab.isVisible()
  if (narrow && (await itemsTab.getAttribute('aria-selected')) !== 'true') await itemsTab.click()
  if (narrow) await page.getByRole('tab', { name: 'Items', selected: true, exact: true }).waitFor()
  await page.getByText(title, { exact: true }).filter({ visible: true }).first().click()
  if (narrow) {
    const inspector = page.getByRole('tab', { name: 'Inspector', exact: true })
    if ((await inspector.getAttribute('aria-selected')) !== 'true') await inspector.click()
  }
  const attachmentCount = READER_TEXT_ATTACHMENTS ? 3 : 1
  const attachments = page.getByRole('button', {
    name: new RegExp(`^(Expand|Collapse) Attachments \\(${attachmentCount}\\)$`),
  })
  if ((await attachments.getAttribute('aria-expanded')) === 'false') await attachments.click()
  await page.getByRole('button', { name: 'Synthetic saved snapshot', exact: true }).click()
  const document = page.getByRole('region', { name: 'Synthetic saved snapshot', exact: true })
  await document.getByRole('heading', { name: 'Captured methods', exact: true }).waitFor()
  if (await document.locator('img').count()) throw new Error('Snapshot mounted an active image')
  if (READER_NON_PDF_HISTORY) {
    await selectReaderText(document.getByRole('heading', { name: 'Captured methods', exact: true }))
    await document.getByRole('button', { name: 'Create excerpt image', exact: true }).click()
    const capture = document.getByRole('region', { name: 'Create excerpt image', exact: true })
    await capture.and(page.locator(':focus')).waitFor()
    await verifyExcerptImage(capture)
    await page.keyboard.press('Escape')
    await capture.waitFor({ state: 'hidden' })
    await selectReaderText(document.getByRole('heading', { name: 'Captured methods', exact: true }))
    await document.getByRole('button', { name: 'Create excerpt image', exact: true }).click()
    await verifyExcerptImage(capture)
    await capture
      .getByRole('button', { name: 'Quote source and text in chat', exact: true })
      .click()
    await capture.getByRole('button', { name: 'Cancel', exact: true }).click()
    console.log(
      'browser reader ok: snapshot excerpt supports Escape and quotes its original text range',
    )
  }
  const closeActive = () =>
    page
      .locator('[data-sidebar-right-session] [role="tab"][aria-selected="true"]')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
  await closeActive()
  await document.waitFor({ state: 'hidden' })
  if (READER_TEXT_ATTACHMENTS) {
    const markdownTitle = 'Synthetic attachment Markdown'
    await page.getByRole('button', { name: markdownTitle, exact: true }).click()
    const markdown = page.getByRole('region', { name: markdownTitle, exact: true })
    const methods = markdown.getByRole('heading', { name: 'Structured methods', exact: true })
    await methods.waitFor()
    await markdown.locator('strong').filter({ hasText: 'bounded result' }).waitFor()
    await markdown.getByText('Source chart', { exact: true }).waitFor()
    if (await markdown.locator('img').count()) throw new Error('Markdown mounted an active image')
    await closeActive()
    await markdown.waitFor({ state: 'hidden' })

    const textTitle = 'Synthetic attachment plain text'
    await page.getByRole('button', { name: textTitle, exact: true }).click()
    const text = page.getByRole('region', { name: textTitle, exact: true })
    const paragraph = text.getByText('Synthetic sample: 𝒳 and β', { exact: false })
    await paragraph.waitFor()
    if (!(await paragraph.textContent())?.includes('literally **written**.'))
      throw new Error('Plain text lost literal Markdown punctuation')
    await selectReaderText(paragraph)
    await text.getByRole('button', { name: 'Create excerpt image', exact: true }).waitFor()
    await closeActive()
    await text.waitFor({ state: 'hidden' })
    console.log('browser reader ok: local Markdown and UTF-8 plain text open from Library')
  }
  if (narrow) await itemsTab.click()
  console.log('browser reader ok: local HTML snapshot opens from Library with inactive resources')
}

/** @param {import('playwright').Page} page @param {string} noteTitle */
async function verifyNonPdfHistory(page, noteTitle) {
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  const citations = page.getByText('Reader citations (2)', { exact: true })
  await citations.waitFor()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await citations.click()
  const historical = page.locator('details').filter({ has: citations })
  const closeActive = () =>
    page
      .locator('[data-sidebar-right-session] [role="tab"][aria-selected="true"]')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
  await historical.getByRole('button', { name: noteTitle, exact: true }).click()
  await page.getByRole('article', { name: noteTitle, exact: true }).waitFor()
  await closeActive()
  await historical.getByRole('button', { name: 'Synthetic saved snapshot', exact: true }).click()
  await page.getByText('Opened the cited text.', { exact: true }).waitFor()
  const highlighted = await page.evaluate(() =>
    Array.from(CSS.highlights?.get('zotero-reader-cited-text') ?? [], String),
  )
  if (highlighted.join() !== 'Captured methods')
    throw new Error('Historical snapshot citation did not highlight its original text')
  await closeActive()
  const libraryTab = page.getByRole('tab', { name: 'Literature panel', exact: true })
  if (await libraryTab.isVisible()) await libraryTab.click()
  else await page.getByRole('button', { name: 'Literature panel', exact: true }).click()
  console.log('browser reader ok: completed citations reopen Zotero notes and the exact HTML range')
}

/** @param {import('playwright').Page} page @param {string} title @param {string} [target] */
async function reviewReaderWrite(page, title, target) {
  await page.getByRole('button', { name: 'Allow once', exact: true }).click()
  await page.getByRole('region', { name: title, exact: true }).waitFor()
  if (target) await page.getByText(target, { exact: true }).waitFor()
  const decision = page.getByRole('button', {
    name: target ? 'Approve' : 'Request changes',
    exact: true,
  })
  if (!(await decision.isVisible())) {
    await page
      .locator('[data-sidebar-right-session] [role="tab"][aria-selected="true"]')
      .filter({ hasText: title })
      .getByRole('button', { name: 'Close', exact: true })
      .click()
  }
  await decision.click()
}

/** @param {import('playwright').Page} page @param {string} fixtureTitle */
async function verifyReaderFlow(page, fixtureTitle) {
  const library = page.getByRole('button', { name: 'Literature panel', exact: true })
  const libraryTab = page.getByRole('tab', { name: 'Literature panel', exact: true })
  const item = page.getByText(fixtureTitle, { exact: true }).filter({ visible: true }).first()
  const read = page.getByRole('button', { name: 'Read PDF', exact: true })
  const reader = page.getByRole('region', { name: 'Zotero Reader', exact: true })
  const secondPage = reader.getByRole('form', { name: /^Page 2 of \d+$/ })
  const openPdf = async () => {
    if (!(await read.isVisible())) {
      if (!(await item.isVisible())) {
        if (await libraryTab.isVisible()) await libraryTab.click()
        else await library.click()
        const items = page.getByRole('tab', { name: 'Items', exact: true })
        if (!(await item.isVisible()) && (await items.isVisible())) await items.click()
      }
      if (!(await read.isVisible())) {
        await item.click({ timeout: 15_000 })
        const inspector = page.getByRole('tab', { name: 'Inspector', exact: true })
        if (await inspector.isVisible()) await inspector.click()
      }
    }
    if (READER_SIBLING_PDF_TITLE === undefined) {
      const start = performance.now()
      await read.click()
      return start
    }
    await read.click()
    const picker = page.getByRole('dialog', { name: 'Choose a PDF to read', exact: true })
    const original = picker
      .getByRole('button', { name: / Read PDF$/ })
      .filter({ hasNotText: READER_SIBLING_PDF_TITLE })
    await original.waitFor()
    const start = performance.now()
    await original.click()
    return start
  }
  const closeReader = async () => {
    await page
      .locator('[data-sidebar-right-session] [role="tab"][aria-selected="true"]')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await reader.waitFor({ state: 'hidden' })
  }
  const initialOpen = await openPdf()
  const firstCanvas = reader.locator('.page[data-page-number="1"] canvas').first()
  await firstCanvas.waitFor()
  const initialMs = Math.round(performance.now() - initialOpen)
  const theme = async (/** @type {'light' | 'dark'} */ colorScheme) => {
    await page.emulateMedia({ colorScheme })
    await page.waitForFunction(
      (dark) => document.body.hasAttribute('data-ds-dark-theme') === dark,
      colorScheme === 'dark',
    )
    return await reader.evaluate((node) => getComputedStyle(node).backgroundColor)
  }
  const paperColor = async () =>
    await firstCanvas.evaluate((node) => {
      if (!(node instanceof HTMLCanvasElement)) throw new Error('Expected a PDF canvas')
      const pixels = node.getContext('2d')?.getImageData(0, 0, 1, 1).data
      if (!pixels) throw new Error('PDF canvas pixels are unavailable')
      return [...pixels].join(',')
    })
  const light = await theme('light')
  const paper = await paperColor()
  const dark = await theme('dark')
  if (dark === light || (await paperColor()) !== paper)
    throw new Error('Reader chrome must follow the host theme and retain the PDF canvas color')
  await theme('light')
  console.log('browser reader ok: light and dark host palettes retain the PDF paper color')
  const outlineToggle = reader.getByRole('button', { name: 'Outline', exact: true })
  const originalViewport = page.viewportSize()
  if (originalViewport && originalViewport.width > 1_000) {
    const fullscreen = page.getByRole('button', { name: 'Fullscreen', exact: true })
    const enteredFullscreen = await fullscreen.isVisible()
    if (enteredFullscreen) await fullscreen.click()
    const detailsToggle = reader.getByRole('button', { name: 'Document details', exact: true })
    await outlineToggle.click()
    await detailsToggle.click()
    await reader.getByRole('button', { name: 'Outline', expanded: true, exact: true }).waitFor()
    await page.setViewportSize({ ...originalViewport, width: 720 })
    await reader.getByRole('button', { name: 'Outline', expanded: false, exact: true }).waitFor()
    await reader
      .getByRole('button', { name: 'Document details', expanded: true, exact: true })
      .waitFor()
    await outlineToggle.press('Enter')
    await reader
      .getByRole('button', { name: 'Document details', expanded: false, exact: true })
      .waitFor()
    await outlineToggle.click()
    await page.setViewportSize(originalViewport)
    if (enteredFullscreen)
      await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click()
    console.log(
      'browser reader ok: narrow layout keeps one drawer open and supports keyboard switching',
    )
  }
  await outlineToggle.click()
  await reader.getByRole('button', { name: 'Float Outline', exact: true }).click()
  const resizeOutline = reader.getByRole('separator', { name: 'Resize Outline', exact: true })
  const outlinePanel = resizeOutline.locator('..')
  const moveOutline = reader.getByRole('button', { name: 'Move Outline with arrow keys or drag' })
  const initialBounds = await outlinePanel.boundingBox()
  if (!initialBounds) throw new Error('Floating outline did not render')
  await moveOutline.press('ArrowRight')
  await moveOutline.press('ArrowDown')
  await resizeOutline.press('ArrowLeft')
  const floated = await outlinePanel.boundingBox()
  if (
    !floated ||
    floated.x <= initialBounds.x ||
    floated.y <= initialBounds.y ||
    floated.width >= initialBounds.width
  )
    throw new Error('Floating outline did not move and resize in the Reader')
  await outlineToggle.click()
  const captureButton = reader.getByRole('button', { name: 'Capture region', exact: true })
  await captureButton.press('Enter')
  const capture = reader.getByRole('dialog', { name: 'Capture region', exact: true })
  const coordinateForm = capture.getByRole('form', { name: 'Capture by coordinates' })
  const leftField = coordinateForm.getByRole('spinbutton', { name: 'Left (%)', exact: true })
  await page.keyboard.press('Tab')
  await leftField.and(page.locator(':focus')).waitFor()
  await coordinateForm.getByRole('spinbutton', { name: 'Height (%)', exact: true }).fill('20')
  await coordinateForm.getByRole('button', { name: 'Preview region', exact: true }).press('Enter')
  await capture.getByRole('img', { name: 'PDF capture preview', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await capture.waitFor({ state: 'hidden' })
  await captureButton.and(page.locator(':focus')).waitFor()
  console.log('browser reader ok: keyboard coordinate capture and Escape restore focus')

  await captureButton.click()
  await capture
    .getByRole('checkbox', { name: 'Print source title and page labels below the image' })
    .check()
  const pageBox = await reader.locator('.page[data-page-number="1"] canvas').first().boundingBox()
  const captureBox = await capture.boundingBox()
  if (!pageBox || !captureBox) throw new Error('PDF capture target has no visible bounds')
  const left = Math.max(pageBox.x, captureBox.x) + 22
  const top = Math.max(pageBox.y, captureBox.y) + 100
  await page.mouse.move(left, top)
  await page.mouse.down()
  await page.mouse.move(left + 100, top + 45, { steps: 4 })
  await page.mouse.up()
  await capture.getByRole('img', { name: 'PDF capture preview', exact: true }).waitFor()
  await capture.getByRole('button', { name: 'Copy PNG', exact: true }).click()
  await capture.getByText('PNG copied. Paste it into the Composer to attach it.').waitFor()
  const signature = await page.evaluate(async () => {
    for (const item of await navigator.clipboard.read()) {
      if (!item.types.includes('image/png')) continue
      const image = await item.getType('image/png')
      return Array.from(new Uint8Array(await image.slice(0, 8).arrayBuffer()))
    }
    return []
  })
  if (signature.join() !== '137,80,78,71,13,10,26,10')
    throw new Error('Reader clipboard does not contain a PNG')
  if (READER_CAPTURE_IMAGE)
    await capture
      .getByRole('button', { name: 'Quote source and text in chat', exact: true })
      .click()
  await capture.press('Escape')
  console.log('browser reader ok: confirmed PDF capture writes a real PNG to the clipboard')
  if (READER_CAPTURE_IMAGE) {
    const editor = page.locator('[contenteditable="true"]:visible')
    await editor.click()
    await page.keyboard.press('ControlOrMeta+V')
    await page.locator('button[aria-busy="false"] > img[src^="blob:"]').waitFor()
    const send = page.getByRole('button', { name: 'Send message', exact: true })
    await send.click()
    const captureReceipt = page.getByText(READER_CAPTURE_ANSWER, { exact: true })
    const failedCapture = page.getByText(READER_CAPTURE_FAILURE, { exact: true })
    await captureReceipt.or(failedCapture).waitFor()
    if (await failedCapture.isVisible()) throw new Error(READER_CAPTURE_FAILURE)
    console.log('browser reader ok: pasted PNG and capture provenance reach the session model')
  }
  if (READER_RESULT_NOTE_PREVIEW) {
    const annotations = reader.getByRole('button', { name: 'Zotero annotations', exact: true })
    await annotations.click()
    const empty = reader.getByText('No Zotero annotations.', { exact: true })
    const unavailable = reader.getByText('Could not load Zotero annotations.', { exact: true })
    await empty.or(unavailable).waitFor()
    if (await unavailable.isVisible())
      throw new Error('Annotation list failed to load from the isolated Zotero attachment')
    await annotations.click()
  }
  const firstText = reader
    .locator('.page[data-page-number="1"] .textLayer span[role="presentation"]')
    .filter({ hasText: /\S/ })
    .first()
  const selectFirst = () =>
    firstText.evaluate((span) => {
      const node = span.firstChild
      const selection = document.getSelection()
      if (!(node instanceof Text) || !selection) throw new Error('PDF text selection unavailable')
      selection.setBaseAndExtent(node, 0, node, node.length)
      document.dispatchEvent(new Event('selectionchange'))
      return node.data.trim()
    })
  const excerpt = await selectFirst()
  if (READER_RESULT_NOTE_PREVIEW) {
    await reader.getByRole('button', { name: 'Translate selection', exact: true }).click()
    const translation = reader.getByRole('region', { name: 'Selection translation', exact: true })
    await translation.getByRole('combobox', { name: 'Target language' }).selectOption('zh')
    await translation.getByRole('button', { name: 'Send excerpt to session model' }).click()
    await translation.getByText(READER_TRANSLATION, { exact: true }).waitFor()
    await translation.getByRole('button', { name: 'Quote original and translation' }).click()
    await page.locator('[data-composer-quote]').getByText(READER_TRANSLATION).waitFor()
    await selectFirst()
    console.log('browser reader ok: selection translation uses the session model transport')
    await reader.getByRole('button', { name: 'Add highlight', exact: true }).click()
    const form = reader.getByRole('form', { name: 'Add highlight', exact: true })
    await form
      .getByRole('button', { name: 'Send selection to session model for a comment', exact: true })
      .click()
    await form.getByText(READER_ANNOTATION_SUGGESTION, { exact: false }).waitFor()
    await form.getByRole('button', { name: 'Use suggested comment', exact: true }).click()
    const comment = form.getByRole('textbox', { name: 'Comment', exact: true })
    if ((await comment.inputValue()) !== READER_ANNOTATION_SUGGESTION)
      throw new Error('Accepted annotation suggestion did not enter the editable draft')
    await form.getByRole('button', { name: 'Save annotation', exact: true }).click()
    await reader.getByText(/Zotero write approval requires an active conversation turn/).waitFor()
    if ((await comment.inputValue()) !== READER_ANNOTATION_SUGGESTION)
      throw new Error('Approval unavailable discarded the annotation draft')
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    console.log(
      'browser reader ok: idle annotation approval refusal retains the editable suggested comment',
    )
    await page.locator('[contenteditable="true"]:visible').press('End')
    await page.keyboard.insertText(READER_APPROVAL_PROMPT)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.getByText(READER_APPROVAL_ANSWER, { exact: true }).waitFor()
    const readerTabId = await reader
      .locator('xpath=ancestor::*[@data-sidebar-right-tab][1]')
      .getAttribute('data-sidebar-right-tab')
    if (!readerTabId) throw new Error('Reader tab identity is unavailable')
    const createTitle = 'Create 1 PDF highlight annotations'
    /** @param {string} title @param {string} [target] */
    const review = async (title, target) => {
      await reviewReaderWrite(page, title, target)
      if (!(await reader.isVisible())) {
        const readerTab = page.getByRole('tab').filter({
          has: page.locator(`[data-sidebar-right-tab=${JSON.stringify(readerTabId)}]`),
        })
        await readerTab.click()
      }
    }
    const create = async (/** @type {string} */ message) => {
      await selectFirst()
      await reader.getByRole('button', { name: 'Add highlight', exact: true }).click()
      if (message) await comment.fill(message)
      await form.getByRole('button', { name: 'Save annotation', exact: true }).click()
    }
    await create('')
    await review(createTitle)
    await reader.getByText('Annotation creation was declined.', { exact: true }).waitFor()
    const annotations = reader.getByRole('button', { name: 'Zotero annotations', exact: true })
    const empty = reader.getByText('No Zotero annotations.', { exact: true })
    await annotations.click()
    await empty.waitFor()
    await annotations.click()
    console.log(
      'browser reader ok: running turn shows session approval and Zotero plan review before any write',
    )
    const probe = await readerWriteProbe()
    if (probe) {
      const original = 'Synthetic Reader browser write probe'
      const edited = 'Synthetic Reader browser write probe after edit'
      await create(original)
      await review(createTitle, `Attachment: ${probe.ref}`)
      console.log(
        'browser reader: approved synthetic annotation plan. Check the isolated Zotero authorization dialog.',
      )
      await reader.getByText('Physical page 1: Annotation saved.', { exact: true }).waitFor({
        timeout: 90_000,
      })
      const rows = await probe.annotations()
      const row = rows[0]
      if (
        rows.length !== 1 ||
        !/^[A-Z0-9]{8}$/.test(row?.key) ||
        row.data.parentItem !== probe.key ||
        row.data.annotationComment !== original
      )
        throw new Error('The new annotation could not be verified in Zotero')
      const ref = `zotero://user/0/annotation/${row.key}?server=${probe.server}`
      await annotations.click()
      await reader.getByRole('button', { name: 'Edit annotation', exact: true }).click()
      await reader.getByRole('textbox', { name: 'Comment', exact: true }).fill(edited)
      await reader.getByRole('button', { name: 'Save annotation', exact: true }).click()
      await review('Update a Zotero item', `Item: ${ref}`)
      await reader.getByText(edited, { exact: true }).waitFor()
      const updated = (await probe.annotations())[0]
      if (updated?.key !== row.key || updated.data.annotationComment !== edited)
        throw new Error('The edited annotation could not be verified in Zotero')
      await reader.getByRole('button', { name: 'Delete annotation', exact: true }).click()
      await reader.getByRole('button', { name: 'Delete', exact: true }).click()
      await review('Permanently delete a Zotero PDF annotation', `Annotation: ${ref}`)
      await empty.waitFor()
      if ((await probe.annotations()).length)
        throw new Error('The isolated Zotero fixture still contains annotations')
      await annotations.click()
      console.log(
        'browser reader ok: created, edited and deleted the synthetic annotation in Zotero',
      )
    }
    await page.getByRole('button', { name: 'Stop generating', exact: true }).click()
    await selectFirst()
  }
  await reader.getByRole('button', { name: 'Quote in chat', exact: true }).click()
  await page.locator('[data-composer-quote]').getByText(excerpt, { exact: true }).waitFor()
  console.log('browser reader ok: PDF excerpt in the Composer draft')
  await reader.getByRole('button', { name: 'Next page', exact: true }).click()
  await secondPage.waitFor()
  const secondText = reader
    .locator('.page[data-page-number="2"] .textLayer span[role="presentation"]')
    .filter({ hasText: /\S/ })
    .first()
  await secondText.waitFor()
  const pageExcerpt = (await secondText.innerText()).trim()
  await reader.getByRole('button', { name: 'Cite PDF', exact: true }).click()
  const citation = reader.getByRole('region', { name: 'Cite PDF', exact: true })
  await citation.getByRole('combobox', { name: 'Citation scope' }).selectOption('pages')
  await citation.getByRole('spinbutton', { name: 'First physical page' }).fill('2')
  await citation.getByRole('spinbutton', { name: 'Last physical page' }).fill('2')
  await citation.getByRole('button', { name: 'Preview excerpt' }).click()
  await citation.getByText(/^Estimated draft size: \d+ tokens$/).waitFor()
  await citation.locator('blockquote').filter({ hasText: pageExcerpt }).waitFor()
  await citation.getByRole('button', { name: 'Add citation to draft' }).click()
  await page.locator('[data-composer-quote]').getByText(pageExcerpt).waitFor()
  console.log('browser reader ok: bounded page citation preview and Composer draft')
  if (!(await secondPage.isVisible()))
    await reader.getByRole('button', { name: 'Next page', exact: true }).click()
  await secondPage.waitFor()
  await closeReader()
  const itemsTab = page.getByRole('tab', { name: 'Items', exact: true })
  const narrow = await itemsTab.isVisible()
  if (narrow) await itemsTab.click()
  const lastRead = item
    .locator('xpath=ancestor::li[1]')
    .locator('time')
    .filter({ hasText: /^Last read/ })
  await lastRead.waitFor()
  if (narrow) await page.getByRole('tab', { name: 'Inspector', exact: true }).click()
  console.log('browser reader ok: Library shows the last read time')
  const reopen = await openPdf()
  await secondPage.waitFor()
  await reader.locator('.page[data-page-number="2"] canvas').first().waitFor()
  const reopenMs = Math.round(performance.now() - reopen)
  await outlineToggle.click()
  const retained = await outlinePanel.boundingBox()
  if (
    !retained ||
    Math.abs(retained.width - floated.width) > 1 ||
    Math.abs(retained.y - floated.y) > 1
  )
    throw new Error('Floating outline geometry was not restored with the PDF')
  await reader.getByRole('button', { name: 'Pin Outline', exact: true }).click()
  await outlineToggle.click()
  console.log(
    'browser reader ok: Floating outline moves, resizes, and restores with the attachment',
  )
  await reader.getByRole('button', { name: 'Previous page', exact: true }).click()
  await reader.getByRole('form', { name: /^Page 1 of \d+$/ }).waitFor()
  if (READER_SIBLING_PDF_TITLE !== undefined) {
    const originalTabId = await reader.evaluate((surface) =>
      surface.closest('[data-sidebar-right-tab]')?.getAttribute('data-sidebar-right-tab'),
    )
    if (!originalTabId) throw new Error('Original attachment has no host tab identity')
    const details = reader.getByRole('button', { name: 'Document details', exact: true })
    await details.click()
    const currentAttachment = reader.locator('aside li span[aria-current="true"]')
    const originalTitle = await currentAttachment.innerText()
    await reader
      .getByRole('button', {
        name: `Zotero annotations in ${READER_SIBLING_PDF_TITLE}`,
        exact: true,
      })
      .click()
    const siblingMark = reader.getByRole('button', { name: 'Methods and findings', exact: true })
    await siblingMark.click()
    await secondPage.waitFor()
    await reader.locator('.page[data-page-number="2"] .zoteroEvidenceRegion').first().waitFor()
    const siblingTabId = await reader.evaluate((surface) =>
      surface.closest('[data-sidebar-right-tab]')?.getAttribute('data-sidebar-right-tab'),
    )
    if (!siblingTabId || siblingTabId === originalTabId)
      throw new Error('Sibling annotation did not open its own attachment tab')
    if ((await details.getAttribute('aria-expanded')) !== 'true') await details.click()
    await reader.getByRole('button', { name: originalTitle, exact: true }).click()
    await reader.getByRole('form', { name: /^Page 1 of \d+$/ }).waitFor()
    console.log('browser reader ok: native sibling annotation opens its own PDF and page')
  }
  await closeReader()
  console.log(
    `browser reader ok: first canvas ${initialMs} ms, restored page canvas ${reopenMs} ms`,
  )

  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await page.getByText('PDF citations (2)', { exact: true }).waitFor()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('PDF citations (2)', { exact: true }).click()
  if (READER_RESULT_NOTE_PREVIEW) {
    const probe = READER_RESULT_NOTE_WRITE ? await readerWriteProbe() : undefined
    if (probe) {
      await page.locator('[contenteditable="true"]:visible').fill(READER_NOTE_APPROVAL_PROMPT)
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      await page.getByText(READER_NOTE_APPROVAL_ANSWER, { exact: true }).waitFor()
    }
    await page.getByRole('button', { name: 'Save response to Zotero', exact: true }).first().click()
    const markdown = page.getByRole('textbox', { name: 'Markdown', exact: true })
    await markdown.waitFor()
    const body = await markdown.inputValue()
    if (!body.includes(READER_ANSWER) || !body.includes('"attachmentRef":"zotero://'))
      throw new Error(
        'The result note preview did not include the answer and attachment provenance',
      )
    const form = page.getByRole('form', { name: 'New note', exact: true })
    if (probe) {
      if (!body.includes(probe.ref))
        throw new Error('The result note did not cite the designated probe attachment')
      await markdown.fill(`${READER_NOTE_MARKER}\n\n${body}`)
      await form.getByRole('button', { name: 'Save note', exact: true }).click()
      await reviewReaderWrite(page, 'Create a linked Zotero note', `Parent: ${probe.parentRef}`)
      const receiptPattern =
        /^Saved zotero:\/\/user\/0\/item\/([A-Z0-9]{8})\?server=([A-Za-z0-9_-]+)\.$/
      const receipt = page.getByRole('status').filter({ hasText: receiptPattern })
      await receipt.waitFor({ timeout: 90_000 })
      const match = (await receipt.innerText()).match(receiptPattern)
      if (!match?.[1] || match[2] !== probe.server)
        throw new Error('The result-note receipt did not identify a note in the probe instance')
      const { data } = await probe.get(match[1])
      if (
        data?.itemType !== 'note' ||
        data.parentItem !== probe.parentKey ||
        ![READER_NOTE_MARKER, READER_ANSWER, probe.ref].every((value) => data.note.includes(value))
      )
        throw new Error('Zotero did not return the saved result note with complete provenance')
      await page.getByRole('button', { name: 'Stop generating', exact: true }).click()
      console.log(
        'browser reader ok: approved result note verified in Zotero with its parent and citation',
      )
    } else {
      await form.getByRole('button', { name: 'Cancel', exact: true }).click()
      console.log('browser reader ok: completed response opens an editable Zotero note draft')
    }
  }
  await page.getByRole('button', { name: /· page 2$/ }).click()
  await secondPage.waitFor()
  await reader.getByRole('button', { name: 'Cite PDF', exact: true }).click()
  await citation.getByRole('combobox', { name: 'Citation scope' }).selectOption('characters')
  await citation.getByRole('button', { name: 'Preview excerpt' }).click()
  const extracted = citation.getByRole('textbox', {
    name: 'Extracted text. Select the portion to cite.',
  })
  const selected = Array.from(await extracted.inputValue())
    .slice(0, 3)
    .join('')
  await citation
    .getByRole('spinbutton', { name: 'Last character position', exact: true })
    .fill(String(selected.length))
  await citation.locator('blockquote').getByText(selected, { exact: true }).waitFor()
  await citation.getByRole('button', { name: 'Add citation to draft' }).click()
  await page.locator('[data-composer-quote]').getByText(selected, { exact: true }).waitFor()
  console.log('browser reader ok: persisted citation opens its original physical page')
  console.log('browser reader ok: character range added to the Composer draft')

  if (READER_NOTES_PAGINATION) await verifyReaderNotesPagination(page, reader)

  if (READER_PARSED_FIXTURE_DIR !== undefined) {
    await reader.locator('.page canvas').first().waitFor()
    if (!(await secondPage.isVisible()))
      await reader.getByRole('button', { name: 'Next page', exact: true }).click()
    await secondText.evaluate((span) => {
      const node = span.firstChild
      const selection = document.getSelection()
      if (!(node instanceof Text) || !selection) throw new Error('PDF text selection unavailable')
      selection.setBaseAndExtent(node, 0, node, node.length)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await reader.getByRole('button', { name: 'Locate in parsed document', exact: true }).click()
    const parsedBlock = page.locator('p[data-parsed-passage], h2[data-parsed-passage]')
    await parsedBlock.filter({ hasText: pageExcerpt }).waitFor()
    const parsedTabId = await parsedBlock.evaluate((block) =>
      block.closest('[data-sidebar-right-tab]')?.getAttribute('data-sidebar-right-tab'),
    )
    if (!parsedTabId) throw new Error('Cached MinerU tab has no host identity')
    const parsedTab = page.getByRole('tab').filter({
      has: page.locator(`[data-sidebar-right-tab=${JSON.stringify(parsedTabId)}]`),
    })
    await selectReaderText(parsedBlock)
    await page.getByRole('menuitem', { name: 'Locate in PDF', exact: true }).click()
    await reader.locator('.page[data-page-number="2"] .zoteroEvidenceRegion').first().waitFor()
    await closeReader()
    await parsedTab.click()
    console.log('browser reader ok: PDF text and cached MinerU block navigate both ways')
    await selectReaderText(parsedBlock)
    await page.getByRole('menuitem', { name: 'Create excerpt image', exact: true }).click()
    const excerpt = page.getByRole('region', { name: 'Create excerpt image', exact: true })
    await verifyExcerptImage(excerpt)
    await excerpt.getByRole('button', { name: 'Quote source and text in chat' }).click()
    await page.locator('[data-composer-quote]').getByText(pageExcerpt, { exact: true }).waitFor()
    await excerpt.getByRole('button', { name: 'Cancel', exact: true }).click()
    await excerpt.waitFor({ state: 'hidden' })
    await selectReaderText(parsedBlock)
    await page.getByRole('menuitem', { name: 'Translate excerpt', exact: true }).click()
    const translation = page.getByRole('region', { name: 'Selection translation', exact: true })
    await translation.getByRole('combobox', { name: 'Target language' }).selectOption('zh')
    await translation.getByRole('button', { name: 'Send excerpt to session model' }).click()
    await translation.getByText(READER_TRANSLATION, { exact: true }).waitFor()
    await translation.getByRole('button', { name: 'Quote original and translation' }).click()
    await page.locator('[data-composer-quote]').getByText(READER_TRANSLATION).waitFor()
    await translation.waitFor({ state: 'hidden' })
    console.log(
      'browser reader ok: parsed selection produces an excerpt PNG and a model translation',
    )
    const parsedTitle = await parsedBlock.evaluate(
      (block) => block.closest('section')?.querySelector('header h2')?.textContent,
    )
    if (!parsedTitle) throw new Error('Reader could not identify the parsed source title')
    const citationSections = page.locator('details').filter({
      has: page.locator('summary').filter({ hasText: /^Reader citations \(\d+\)$/ }),
    })
    const citationIndex = await citationSections.count()
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    const parsedCitations = citationSections.nth(citationIndex)
    await parsedCitations.locator('summary').click()
    await parsedCitations.getByRole('button', { name: parsedTitle, exact: true }).last().click()
    await page.waitForFunction((text) => {
      const highlights = CSS.highlights.get('zotero-parsed-cited-text')
      return highlights && [...highlights].some((range) => range.toString() === text)
    }, pageExcerpt)
    console.log('browser reader ok: completed parsed translation reopens its exact text range')

    if (READER_PARSED_GEOMETRY) {
      const locations = page.getByText('Parsed locations', { exact: true })
      await locations.click()
      const figure = page.getByRole('listitem').filter({ hasText: 'Synthetic figure region' })
      await figure.getByRole('button', { name: 'Locate in PDF', exact: true }).click()
      await reader.getByText('Highlighted the region reported by the parser.').waitFor()
      const readerTabId = await reader.evaluate((surface) =>
        surface.closest('[data-sidebar-right-tab]')?.getAttribute('data-sidebar-right-tab'),
      )
      if (!readerTabId) throw new Error('Reader tab has no host identity')
      const figureMark = reader.locator('.page[data-page-number="2"] .zoteroEvidenceRegion').first()
      const found = await figureMark.boundingBox()
      if (!found) throw new Error('Expected a visible parsed figure rectangle on page 2')
      await reader.getByRole('button', { name: 'Capture region', exact: true }).click()
      const capture = reader.getByRole('dialog', { name: 'Capture region', exact: true })
      const surface = await capture.boundingBox()
      if (!surface) throw new Error('PDF region picker has no bounds')
      const left = Math.max(found.x + 4, surface.x + 4)
      const top = Math.max(found.y + 4, surface.y + 4)
      const right = Math.min(found.x + found.width - 4, surface.x + surface.width - 4)
      const bottom = Math.min(found.y + found.height - 4, surface.y + surface.height - 4)
      if (right - left < 20 || bottom - top < 20)
        throw new Error('Parsed figure overlay is outside the visible region picker')
      await page.mouse.move(left, top)
      await page.mouse.down()
      await page.mouse.move(right, bottom, { steps: 4 })
      await page.mouse.up()
      await capture.getByRole('img', { name: 'PDF capture preview', exact: true }).waitFor()
      await capture.getByRole('button', { name: 'Locate in parsed document', exact: true }).click()
      await figure.getByText('Synthetic figure region', { exact: false }).waitFor()
      await page
        .getByText('Matched the highlighted entry using its stored page coordinates.')
        .waitFor()
      if ((await figure.getAttribute('data-parsed-passage')) === null)
        throw new Error('The PDF region did not select the cached figure entry')
      console.log(
        'browser reader ok: textless PDF region and cached MinerU figure navigate both ways',
      )
      await figure.getByRole('button', { name: 'Quote parsed entry', exact: true }).click()
      await page.locator('[data-composer-quote]').getByText('Synthetic figure region').waitFor()
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      const figureLink = page
        .locator('button')
        .filter({ hasText: /Synthetic figure region · page 2$/ })
      const figureCitations = page.locator('details').filter({ has: figureLink })
      await figureCitations.locator('summary').click()
      await figureCitations.locator(figureLink).click()
      await reader.getByText('Highlighted the region reported by the parser.').waitFor()
      console.log('browser reader ok: completed parsed figure quote reopens its PDF region')
      if (READER_CACHED_REGION_TEXT) {
        const paper = reader.locator('.page[data-page-number="2"] canvas').first()
        await paper.evaluate((canvas) => canvas.scrollIntoView({ block: 'center' }))
        const canvas = await paper.boundingBox()
        if (!canvas) throw new Error('Reader capture source canvas is missing')
        await reader.getByRole('button', { name: 'Capture region', exact: true }).click()
        const [x1, y1, x2, y2] = [0.22, 0.53, 0.44, 0.63]
        await page.mouse.move(canvas.x + x1 * canvas.width, canvas.y + y1 * canvas.height)
        await page.mouse.down()
        await page.mouse.move(canvas.x + x2 * canvas.width, canvas.y + y2 * canvas.height, {
          steps: 4,
        })
        await page.mouse.up()
        await capture.getByRole('img', { name: 'PDF capture preview', exact: true }).waitFor()
        if (await capture.getByText('Text in this region', { exact: true }).count())
          throw new Error('Cached region fixture must have no native PDF text in its crop')
        await capture.getByRole('button', { name: 'Read cached region text', exact: true }).click()
        const text = 'Synthetic scan transcription'
        await capture.locator('details[open]').getByText(text, { exact: true }).waitFor()
        await capture
          .getByRole('button', { name: 'Quote source and text in chat', exact: true })
          .click()
        await page.locator('[data-composer-quote]').getByText(text).waitFor()
        await capture.getByRole('button', { name: 'Cancel', exact: true }).click()
        await page.getByRole('button', { name: 'Send message', exact: true }).click()
        console.log(
          'browser reader ok: textless capture quotes the cached, source-bound transcript',
        )
      }
      await page
        .getByRole('tab')
        .filter({
          has: page.locator(`[data-sidebar-right-tab=${JSON.stringify(readerTabId)}]`),
        })
        .click()
      await closeReader()
    }
  } else {
    await closeReader()
  }

  if (READER_EVIDENCE_REF !== undefined) {
    await page.locator('[contenteditable="true"]:visible').fill(READER_EVIDENCE_PROMPT)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.getByText(READER_EVIDENCE_ANSWER, { exact: true }).waitFor()
    const trail = page.getByRole('tab', { name: 'Literature trail', exact: true })
    if (await trail.isVisible()) await trail.click()
    else {
      await page.getByRole('button', { name: 'More conversation views', exact: true }).click()
      await clickMenuItem(page, 'Literature trail')
    }
    const sources = page.locator('[data-conversation-composer-overlay]')
    const sourceEntry = sources.locator('[role="option"]').first()
    await sourceEntry.click()
    await page.getByRole('button', { name: 'Locate page in sidebar →', exact: true }).click()
    await reader.locator('.page[data-page-number="2"] .zoteroEvidenceRegion').first().waitFor()
    await closeReader()
    console.log(
      `browser reader ok: live Zotero ${READER_SEMANTIC_MODEL_DIR === undefined ? 'BM25' : 'ONNX-ranked'} evidence opens and highlights the retrieved PDF text`,
    )
    const claimsSummary = sources.getByText('Claims and evidence', { exact: true })
    await claimsSummary.click()
    const claims = claimsSummary.locator('xpath=..')
    const checklist = claims.getByRole('form')
    const statement = 'The fixture has a findings section.'
    await checklist.locator('textarea').fill(statement)
    await checklist.locator('select[name="relation"]').selectOption('supports')
    await checklist.locator('select[name="review"]').selectOption('verified')
    await checklist.getByRole('button', { name: 'Save evidence link', exact: true }).click()
    const claim = claims.locator('details').filter({ hasText: statement })
    await claim.locator('summary').click()
    await claim.getByRole('button', { name: 'Locate page in sidebar →', exact: true }).click()
    await reader.locator('.page[data-page-number="2"] .zoteroEvidenceRegion').first().waitFor()
    await closeReader()
    console.log('browser reader ok: verified claim link reopens the selected PDF passage')
  }

  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  await page
    .locator('[data-plugin-package="dsh-zotero"]')
    .getByRole('button', { name: /^View / })
    .click()
  const row = page.locator('[data-plugin-row]').filter({
    has: page.getByText('dsh-zotero/reader', { exact: true }),
  })
  await row.getByRole('switch').click()
  await row.and(page.locator('[data-state="off"]')).waitFor()
  await page.reload({ waitUntil: 'domcontentloaded' })
  const onboarding = page.getByRole('dialog', { name: 'Get started', exact: true })
  await onboarding.or(library).first().waitFor()
  if (await onboarding.isVisible()) {
    await onboarding.getByRole('button', { name: 'Close', exact: true }).click()
  }
  if (await libraryTab.isVisible()) await libraryTab.click()
  else await library.click()
  await openPdf()
  await page.locator('[data-pdf-page="1"] canvas').first().waitFor()
  if (await reader.isVisible()) throw new Error('Reader remained visible after disabling it')
  console.log('browser reader ok: native fallback after disable')
}

main().catch((error) => {
  console.error(`discovery-smoke: FAILED: ${error.message}`)
  process.exitCode = 1
})
