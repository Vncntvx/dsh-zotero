/**
 * Client-graph runtime authority for the dsh-zotero browser bundle.
 *
 * Pure predicates and the esbuild resolve/metafile plugin that keep host
 * authority (zod codecs, Typert manifest, host services) out of
 * `lib/client.js`. `scripts/build-client.mjs` consumes this module; unit
 * tests drive the same rules against fixture graphs.
 * @module dsh-zotero/scripts/client-graph-authority
 */

/**
 * Local sources the browser graph may value-import.
 *
 * Written as **runtime authority**, not as a denylist of files that happen to
 * import zod today:
 *
 * - `src/client/**` — the browser half.
 * - Shared pure surfaces both halves already use: wire identity (`contract`),
 *   settings wire name (`settings-namespace`), JSON guards (`json`), the
 *   `zotero://` ref grammar (`ref-grammar`), export-key grammar
 *   (`export-items`), the changes projection contract (`changes-contract`),
 *   the browse row classification (`browse-rows`), and the evidence-passage
 *   shape (`evidence-item`) host presentation and the Chat card share.
 *
 * Host codecs, the Typert manifest, the host Remote service, providers, tools,
 * and the HTTP stack must never enter this graph. A new shared module joins
 * this list deliberately and must stay free of host authority.
 */
export const CLIENT_SAFE_LOCAL =
  /^src\/(?:client(?:\/|$)|contract\.(?:ts|js|mjs|cjs)$|settings-namespace\.(?:ts|js|mjs|cjs)$|json\.(?:ts|js|mjs|cjs)$|ref-grammar\.(?:ts|js|mjs|cjs)$|export-items\.(?:ts|js|mjs|cjs)$|changes-contract\.(?:ts|js|mjs|cjs)$|browse-rows\.(?:ts|js|mjs|cjs)$|evidence-item\.(?:ts|js|mjs|cjs)$)/

/**
 * Packages the host half owns. Boundary schema materialization (zod for the
 * Typert wire codecs, schemastery for Config schemas) is host registration
 * only; the client Remote face mounts structural descriptors.
 */
export const HOST_ONLY_PACKAGE_RESOLVE = /^(?:zod|@deepseek-ai\/schemastery)(?:\/|$)/
export const HOST_ONLY_PACKAGE_INPUT =
  /(?:^|\/)node_modules\/(?:zod|@deepseek-ai\/schemastery)(?:\/|$)/

/**
 * The third-party packages this bundle may bring **into itself**, with no
 * runtime dependency on the loader's module table. Every entry must be a
 * package the browser bundle genuinely bundles; a package absent from both
 * this list and `EXTERNALS` is refused, so a later import cannot slip in
 * as a silent second copy of a module the shell already shares.
 *
 * `clsx` is the whole list: a tiny classname joiner with no module identity
 * the shell needs to share. React and its family are the opposite case —
 * they must stay external so every bundle sees one instance — and are
 * therefore in `EXTERNALS`, not here.
 */
export const CLIENT_INLINE_PACKAGES = ['clsx']

/**
 * Whether a `node_modules/` graph input belongs to a package the allowlist
 * admits. A file's package is the one that physically owns it, so a nested
 * dependency (`node_modules/a/node_modules/b/...`) is judged as `b` — the
 * package whose code would actually be bundled — and not as its parent. The
 * leading `.*` is greedy precisely to select the last `node_modules/` segment.
 * @param key - normalized metafile input key.
 * @returns the package name when the input is inside one, else undefined.
 */
export function packageNameOf(key) {
  const match = /^(?:.*\/)?node_modules\/(@[^/]+\/[^/]+|[^/]+)(?:\/|$)/.exec(key)
  if (match === null || match[1] === undefined) return undefined
  return match[1]
}

/**
 * Harness specifiers a client bundle may **inline**. Counterpart of the three
 * constants in `packages/client/tsdown.client.ts` at **dsh-v0.2.1-alpha.1**:
 * `INLINE_SAFE`, `GENERATED_REMOTE`, `VENDORED_LIBRARY`. Keep this table in
 * step with that file — never invent a fourth arm here.
 */
export const INLINE_SAFE =
  /^(?:@deepseek-ai\/dsh-(?:file-reference|session|llm|tools|brand|deque|output-retention|typert-protocol|util-crypto|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-native-command\/types$|@deepseek-ai\/dsh-host-open-in-app\/shared$|@deepseek-ai\/dsh-plugin-manager\/registry$|@deepseek-ai\/dsh-agent-preset-registry\/display$|@deepseek-ai\/dsh-api-workspace-controller\/default-workspace$|@deepseek-ai\/dsh-spill-policy\/notice$)/
export const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/
export const VENDORED_LIBRARY = /^@deepseek-ai\/(?:cosmokit|schemastery)(?:\/|$)/

/**
 * Whether a harness `@deepseek-ai/*` specifier may enter the client bundle by
 * inlining (as opposed to the loader module table / `EXTERNALS`).
 * @param specifier - the import specifier as resolved.
 * @returns true when the harness purity rule allows an inline copy.
 */
export function isInlineSafeHarness(specifier) {
  return (
    INLINE_SAFE.test(specifier) ||
    GENERATED_REMOTE.test(specifier) ||
    VENDORED_LIBRARY.test(specifier)
  )
}

/**
 * Normalize an esbuild metafile input key to a posix `src/...` /
 * `node_modules/...` spelling.
 * @param key - raw metafile input path.
 * @returns normalized key.
 */
function normalizeInputKey(key) {
  return key.replaceAll('\\', '/').replace(/^\.\//, '')
}

/**
 * Classify client-graph inputs against runtime authority.
 * @param inputs - esbuild `metafile.inputs` (or equivalent path→record map).
 * @returns violations, each naming the input and why it may not ship.
 */
export function clientGraphViolations(inputs) {
  const violations = []
  for (const raw of Object.keys(inputs ?? {})) {
    const key = normalizeInputKey(raw)
    if (HOST_ONLY_PACKAGE_INPUT.test(key)) {
      violations.push({
        kind: 'host-package',
        key,
        detail:
          'host-owned package — boundary codecs materialize on the host half only (src/status-codec.ts)',
      })
      continue
    }
    const pkg = packageNameOf(key)
    if (pkg !== undefined) {
      // A bundled package must be a declared choice: either an allowed
      // third-party module (CLIENT_INLINE_PACKAGES) or an inline-safe
      // harness utility (isInlineSafeHarness). Anything else — including
      // an `EXTERNALS` package that got inlined, which would give the page
      // a second copy of a shared module — is refused.
      if (
        pkg !== 'zod' &&
        pkg !== '@deepseek-ai/schemastery' &&
        !CLIENT_INLINE_PACKAGES.includes(pkg) &&
        !isInlineSafeHarness(pkg)
      ) {
        violations.push({
          kind: 'unknown-package',
          key,
          detail:
            `package "${pkg}" is neither externalized nor on CLIENT_INLINE_PACKAGES` +
            ' — add it to EXTERNALS when the loader table serves it' +
            ' (harness packages/client/web/src/platform.ts PLATFORM_MODULES),' +
            ' or to CLIENT_INLINE_PACKAGES when the bundle should carry its only copy',
        })
      }
      continue
    }
    if (!key.startsWith('src/')) continue
    if (!CLIENT_SAFE_LOCAL.test(key)) {
      violations.push({
        kind: 'host-local',
        key,
        detail:
          'not on the client-safe local allowlist (src/client/** + shared pure surfaces) — host authority stays on the host half',
      })
    }
  }
  return violations
}

/**
 * Esbuild plugin: refuse host-only packages at resolve time, then re-check
 * every local `src/**` input (and any `node_modules/zod`) via metafile on
 * each successful build. Independent of minify and of path comments.
 * @returns the `client-graph-authority` esbuild plugin.
 */
export function createClientAuthorityPlugin() {
  return {
    name: 'client-graph-authority',
    setup(build) {
      build.onResolve({ filter: HOST_ONLY_PACKAGE_RESOLVE }, (args) => {
        return {
          errors: [
            {
              text:
                `client graph resolved host-owned package "${args.path}" from ${args.importer || '(entry)'}` +
                ' — import structural identity from src/contract.ts;' +
                ' host zod/schemastery codecs live only in src/status-codec.ts and src/config.ts' +
                ' and must never enter src/client',
            },
          ],
        }
      })
      build.onEnd((result) => {
        if (result.errors.length > 0) return
        const violations = clientGraphViolations(result.metafile?.inputs)
        if (violations.length === 0) return undefined
        return {
          errors: violations.map((violation) => ({
            text: `client graph authority: ${violation.key} — ${violation.detail}`,
          })),
        }
      })
    },
  }
}
