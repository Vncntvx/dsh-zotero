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

/** Resolve and import all four host entries from the consumer's fresh profile. */
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
      import { pathToFileURL } from 'node:url'
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
        for (const suffix of ['', '/library', '/scholarly', '/enrichment']) {
          const name = ${JSON.stringify(PLUGIN_ID)} + suffix
          const entry = await import(name)
          if (typeof entry.default !== 'function') throw new Error(name + ' lacks a loadable service')
          console.log('installed entry ok: ' + name)
        }
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
 */
async function pinDocumentsDirectory() {
  const documents = join(HOME, 'Documents')
  await mkdir(documents, { recursive: true })
  const patchPath = join(HOME, 'profiles', PROFILE, 'cordis.patch.yml')
  await writeFile(
    patchPath,
    `# Written by scripts/discovery-smoke.mjs: the smoke's own Documents root.\n- id: workspace-controller\n  config:\n    documentsDirectory: ${documents}\n`,
  )
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
  const suppliedTarball = argAfter('--tarball')
  const tarball = suppliedTarball === undefined ? packPath() : resolve(suppliedTarball)
  console.log(`packed: ${tarball}`)
  console.log(`home: ${HOME} (profile ${PROFILE})`)

  await initializeProfile()

  await runDsh(['plugin', '--profile', PROFILE, 'add', tarball])
  await verifyInstalledEntries()
  if (!process.argv.includes('--install-only')) await pinDocumentsDirectory()

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
  const web = dshCommand(['web', '--port', String(port)])
  const child = spawn(web.command, web.args, {
    // Both pipes go to the log file: an undrained pipe deadlocks the child
    // once its boot output exceeds the pipe buffer.
    stdio: ['ignore', logFd, logFd],
    env: ENV,
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
    if (process.argv.includes('--browser')) await verifyBrowser(port, cookie)
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
  const browser = await chromium.launch({ headless: true })
  const browserContext = await browser.newContext()
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
      const sheets = [...document.querySelectorAll('head style[data-plugin-css]')]
      const stylesheet = id + '/src/client/ZoteroSettingsSection.module.css'
      const owned = sheets.filter((sheet) => sheet.getAttribute('data-plugin-css') === stylesheet)
      return {
        owned: owned.length === 1 && owned[0].getAttribute('data-plugin') === id,
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
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('dialog', { name: 'Get started', exact: true }).waitFor()
    await page
      .getByRole('dialog', { name: 'Get started', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    try {
      await page.waitForFunction(
        () => document.querySelector('button[aria-label="Literature panel"]') !== null,
        undefined,
        { timeout: 15_000 },
      )
    } catch (error) {
      const body = await page
        .locator('body')
        .innerText()
        .catch(() => '')
      throw new Error(
        `${/** @type {Error} */ (error).message}; body=${body.slice(0, 500)}; pageErrors=${pageErrors.join('|')}`,
      )
    }
    const panel = page.getByRole('button', { name: 'Literature panel', exact: true })
    if ((await panel.count()) !== 1) {
      throw new Error(
        'the browser registered an unexpected number of Zotero literature panel controls',
      )
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
    await page.getByRole('tab', { name: 'Literature panel', exact: true }).click()
    await page.getByRole('button', { name: 'List density', exact: true }).waitFor()
    const settings = page.locator('[data-zotero-config-page]')
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
    const preferences = settings.locator('[data-library-preferences]')
    const save = preferences.getByRole('button', { name: 'Save', exact: true })
    if (!(await save.isEnabled())) throw new Error('The staged appearance edit cannot be saved')
    await save.click()
    await preferences.getByRole('button', { name: 'Save', exact: true }).waitFor()
    if (await preferences.getByRole('button', { name: 'Save', exact: true }).isEnabled())
      throw new Error('The settings save did not settle as accepted')
    const citation = settings.getByRole('region', { name: 'Citation defaults', exact: true })
    await citation.getByLabel('Default citation style', { exact: true }).fill('vancouver')
    await citation.getByLabel('Default citation locale', { exact: true }).fill('zh-CN')
    await citation.getByRole('button', { name: 'Save', exact: true }).click()
    await citation.getByRole('button', { name: 'Save', exact: true }).waitFor()
    if (await citation.getByRole('button', { name: 'Save', exact: true }).isEnabled())
      throw new Error('Direct citation-default edits were not accepted')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page
      .getByRole('dialog', { name: 'Get started', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    await page
      .locator('[data-plugin-package="dsh-zotero"]')
      .getByRole('button', { name: /^View / })
      .click()
    await page.getByRole('tab', { name: 'Literature panel', exact: true }).click()
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

main().catch((error) => {
  console.error(`discovery-smoke: FAILED: ${error.message}`)
  process.exitCode = 1
})
