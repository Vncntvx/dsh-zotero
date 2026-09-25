/**
 * Detecting a shell command that would write to Zotero's own local API.
 *
 * The plugin's write gate is the `ctx.zotero` seam, and a shell can reach
 * Zotero's write API without ever touching that seam. Nothing inside the
 * plugin can close that hole by itself: `approval/asked` fires only for what
 * the tool pipeline asks about, and the sandbox confines file effects rather
 * than network access. So the plugin does not try to *block* the route — it
 * makes the route ask. A detected command raises the harness's own approval
 * request before the body runs (`tools/pre-execute` → `{kind: 'ask'}`), so the
 * write happens only if the user confirms that one call, and does not happen
 * when they reject it, cancel it, run with the `never` policy (which
 * auto-rejects every ask), or have no approval channel at all.
 *
 * This module is the detector only: pure, synchronous, and total. It reads the
 * command text, which is why it is a detector rather than a guarantee — these
 * all pass it unseen:
 * - a request written into a script file and then executed (`bash build.sh`);
 * - an interpreter whose command text never spells the endpoint
 *   (`python -c '...'`, `node -e '...'` with the URL assembled at runtime);
 * - the URL carried in an environment variable, a heredoc, or an encoding;
 * - a loopback port other than the configured one, except for writes to the
 *   users path (those are caught on any loopback port — see
 *   {@link USERS_WRITE});
 * - any binary of the user's own.
 *
 * The rule is a read-only allow: `GET` probes of the local API, debugging
 * curls, and requests to any other host are not writing, so they are left
 * alone. What it matches is the authorize endpoint (which exists only to
 * obtain a write key), and — only when an HTTP-client invocation is present —
 * a write method or body flag alongside the configured local API address.
 * Anchoring on the client is what keeps an ordinary command that merely names
 * the address, and uses an unrelated flag such as `rm -f`, from asking.
 *
 * Every proximity match is **segment-scoped**: shell separators (`;`, `&&`,
 * `|`, newlines) bound the steps one command runs, and a `POST` in a later
 * step is not a method for the request in an earlier one. `curl -s …?limit=1
 * && echo POST done` is a read followed by an unrelated echo, not a write.
 * @module dsh-zotero/shell-write-detector
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { LOOPBACK_HOSTNAMES, type ResolvedConfig } from './config.js'
import { WRITE_TOOL_NAMES, ZOTERO_AUTHORIZE_PATH } from './constants.js'
import { asRecord, asString } from './json.js'

/** The shell tools whose command text this detector can read. */
export const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set(['bash', 'pwsh'])

/** The endpoint that exists only to hand out a write key. */
const AUTHORIZE_PATH = new RegExp(`/api/${ZOTERO_AUTHORIZE_PATH}\\b`)

/** An explicit method flag: `curl -X POST`, `--request=DELETE`, `-Method Post`. */
const EXPLICIT_METHOD = /(?:-X|--request|-Method)[\s=:]*['"]?(?:POST|PUT|PATCH|DELETE)\b/i

/**
 * An HTTP client invocation, which is what makes a nearby flag a *write*
 * intent. Without this anchor the rule matched any command that merely named
 * the local address and used a common flag somewhere — `rm -f` after a
 * `curl -s …?limit=1` read was enough to raise an approval prompt. The
 * `http`/`https` CLIs are deliberately absent: every URL contains the scheme,
 * so matching it would re-anchor the rule on nothing. The bare-method shape
 * below covers them instead.
 */
const WRITER_PROGRAM = /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i

/**
 * Shell separators, which bound the steps one command runs. A flag in a later
 * step is not a flag for the request in an earlier one: `curl -s …?limit=1 -o
 * /dev/null && date -d yesterday` is a read followed by an unrelated command,
 * not a write.
 */
const SEGMENT_SEPARATOR = /[;&|\n]+/

/** Backslash-newline continues one command; glue those before splitting. */
const LINE_CONTINUATION = /\\\r?\n/g

/**
 * Split a command into the steps a shell would run. A backslash-newline
 * continues one command across lines, so those are glued first and a wrapped
 * `curl` stays a single segment.
 * @param text - the raw command text.
 * @returns one entry per shell step.
 */
function segmentsOf(text: string): readonly string[] {
  return text.replace(LINE_CONTINUATION, ' ').split(SEGMENT_SEPARATOR)
}

/**
 * curl's and wget's short body/upload flags, spelled case-sensitively: `-d`
 * (data), `-T` (upload-file), `-F` (form). Case-insensitivity here would make
 * `-D`, `-t`, and `-f` — `rm -f`, `grep -f`, `curl -f` — count as writes.
 */
const SHORT_WRITE_FLAG = /(?:^|[\s'"=])(?:-d|-T|-F)\b/

/**
 * The unambiguous long spellings, case-insensitive so PowerShell's `-Body`
 * and `-InFile` are covered alongside curl's and wget's.
 */
const LONG_WRITE_FLAG =
  /(?:^|[\s'"=])(?:--data|--data-binary|--data-raw|--data-urlencode|--post-data|--post-file|--json|--upload-file|--form|-Body|-InFile)\b/i

/** Any write-shaped flag, given a writer invocation. */
function hasWriteFlag(text: string): boolean {
  return SHORT_WRITE_FLAG.test(text) || LONG_WRITE_FLAG.test(text)
}

/**
 * A method token spelled as an argument, as the `http`/`httpie` CLI takes it.
 * Global form is the scan copy `near` walks; the non-global twin stays the
 * readable spelling.
 */
const BARE_METHOD = /\b(?:POST|PUT|PATCH|DELETE)\b/g

/** A client-library write call: `requests.post(`, `urlopen(... data=`, `.patch(`. */
const LIBRARY_WRITE = /\.(?:post|put|patch|delete)\s*\(/gi

/**
 * A write to the Local API users path (`/api/users/<id>/…`), which is how
 * item, note, and collection writes are addressed. Host-agnostic on purpose
 * only about *port*: the shape still requires a loopback host near the match
 * (see {@link nearLoopback}), so a write against `api.zotero.org` is never
 * mistaken for a library write while `127.0.0.1:9999` still is.
 */
const USERS_WRITE = /(?:POST|PUT|PATCH|DELETE)\b[^|;&]{0,80}?\/api\/users\/\d+\//g

/** How far apart two parts of one heuristically-joined match may sit. */
const NEAR_WINDOW = 60

/** One matched shape, with the human name the approval texts report. */
interface WriteShape {
  /** How the texts name what was seen, per locale. */
  readonly label: ShapeLabel
  /** Whether the command text carries this shape. */
  readonly test: (text: string, aliases: readonly string[]) => boolean
}

/** The localized name of one detected shape. */
interface ShapeLabel {
  readonly en: string
  readonly zh: string
}

/** One detected write attempt, ready to become an approval request. */
export interface ShellWriteAttempt {
  /**
   * The audit and fallback reason. It travels into `approval/asked`, and it is
   * what the model reads when no approval channel exists at all, so it names
   * the sanctioned route as well as what was detected.
   */
  readonly reason: string
  /** The localized text the approval panel shows instead of {@link reason}. */
  readonly displayReason: { readonly en: string; readonly zh: string }
}

/** Whether the text names the local API address in any of its loopback spellings. */
function namesAuthority(text: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => text.includes(alias))
}

/**
 * Whether the text names any loopback host. Distinct from
 * {@link namesAuthority}: that asks about the *configured* `host:port`, this
 * asks about loopback at all — which is what the users-path shape needs, so a
 * write on another loopback port is still a library write.
 */
function namesLoopback(text: string): boolean {
  for (const host of LOOPBACK_HOSTNAMES) {
    if (text.includes(host)) return true
  }
  return false
}

/**
 * Whether `pattern` and the local address both appear in this step, within
 * {@link NEAR_WINDOW}. `pattern` must already carry the `g` flag; the walk is
 * segment-scoped so a match never crosses a shell separator.
 */
function near(text: string, pattern: RegExp, aliases: readonly string[]): boolean {
  for (const match of text.matchAll(pattern)) {
    const from = Math.max(0, match.index - NEAR_WINDOW)
    const window = text.slice(from, match.index + match[0].length + NEAR_WINDOW)
    if (namesAuthority(window, aliases)) return true
  }
  return false
}

/** {@link near}, but the second anchor is any loopback host rather than the configured port. */
function nearLoopback(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    const from = Math.max(0, match.index - NEAR_WINDOW)
    const window = text.slice(from, match.index + match[0].length + NEAR_WINDOW)
    if (namesLoopback(window)) return true
  }
  return false
}

/** Whether any shell step in `text` matches `probe`. */
function anySegment(text: string, probe: (segment: string) => boolean): boolean {
  return segmentsOf(text).some(probe)
}

/** The write-request label shared by the two spellings of the same shape. */
const LABEL_WRITE_REQUEST: ShapeLabel = {
  en: 'a write request to the local API address',
  zh: '对本地 API 地址的写请求',
}

/**
 * The matched shapes, most specific first. Each is deliberately anchored on
 * the configured local address, on a loopback host of the users path, or on
 * the authorize path — so an unrelated `curl -d` against another service is
 * never mistaken for a library write.
 */
const WRITE_SHAPES: readonly WriteShape[] = [
  {
    label: {
      en: 'the local-API authorize endpoint',
      zh: '本地 API 的授权端点（/api/local/authorize）',
    },
    test: (text) => AUTHORIZE_PATH.test(text),
  },
  {
    label: LABEL_WRITE_REQUEST,
    test: (text, aliases) =>
      anySegment(
        text,
        (segment) =>
          namesAuthority(segment, aliases) &&
          WRITER_PROGRAM.test(segment) &&
          (EXPLICIT_METHOD.test(segment) || hasWriteFlag(segment)),
      ),
  },
  {
    label: LABEL_WRITE_REQUEST,
    test: (text, aliases) => anySegment(text, (segment) => near(segment, BARE_METHOD, aliases)),
  },
  {
    label: {
      en: 'a client-library write call to the local API address',
      zh: '对本地 API 地址的客户端库写调用',
    },
    test: (text, aliases) => anySegment(text, (segment) => near(segment, LIBRARY_WRITE, aliases)),
  },
  {
    label: {
      en: 'a write to the local users endpoint',
      zh: '对本地 users 端点的写请求',
    },
    // Loopback near the write, not the configured port: a users write on
    // 127.0.0.1:9999 is still this library, while the same shape against
    // api.zotero.org is not.
    test: (text) => anySegment(text, (segment) => nearLoopback(segment, USERS_WRITE)),
  },
]

/** One-slot-per-baseUrl cache of the configured address's host:port spellings. */
const aliasCache = new Map<string, readonly string[]>()

/**
 * The loopback spellings of the configured local API address. The config pins
 * a loopback hostname to an IP literal, so the aliases carry every equivalent
 * spelling a command might use. Memoized by the `baseUrl` string — the value
 * only moves when the Loader volatile entry is rebuilt.
 * @param baseUrl - the resolved `baseUrl`.
 * @returns the `host:port` spellings to match.
 */
function authorityAliases(baseUrl: string): readonly string[] {
  const cached = aliasCache.get(baseUrl)
  if (cached !== undefined) return cached
  let aliases: readonly string[] = []
  try {
    const port = new URL(baseUrl).port
    if (port !== '') {
      aliases = [...LOOPBACK_HOSTNAMES].map((host) => `${host}:${port}`)
    }
  } catch {
    aliases = []
  }
  aliasCache.set(baseUrl, aliases)
  return aliases
}

/** The command text of a shell tool call, when the call carries one. */
function commandTextOf(execution: Pick<ToolExecution, 'name' | 'arguments'>): string | undefined {
  if (!SHELL_TOOL_NAMES.has(execution.name)) return undefined
  const command = asString(asRecord(execution.arguments)?.command)
  return command !== undefined && command.trim() !== '' ? command : undefined
}

/** The audit reason for one detected attempt. It is English, like every audit field. */
function reasonOf(label: string): string {
  return [
    `a shell command runs ${label}, which would change the Zotero library outside the plugin`,
    `library writes go through ${WRITE_TOOL_NAMES.join(', ')} only, where the user approves a plan first`,
    'this call needs an approval to run, and is denied when the user declines, when the session approval policy is "never", or when no approval channel is available',
  ].join('; ')
}

/**
 * The localized text the approval panel shows for one detected attempt. Both
 * arms are written in their own language: the label is translated rather than
 * interpolated from the English audit spelling.
 */
function displayReasonOf(label: ShapeLabel): { en: string; zh: string } {
  return {
    en: `Allow this command? It runs ${label.en}, changing your Zotero library directly through the local API — outside the plugin's write tools, so no plan is shown and no version checks apply. The plugin's write tools (${WRITE_TOOL_NAMES.join(', ')}) are the reviewed route.`,
    zh: `允许这条命令吗？它执行的是${label.zh}，会绕过插件的写工具、直接通过本地接口修改你的 Zotero 文库——没有计划确认，也没有版本检查。插件的写工具（${WRITE_TOOL_NAMES.join('、')}）才是经过确认的路径。`,
  }
}

/**
 * Decide whether one tool call is a shell write against Zotero's own API.
 *
 * Total and synchronous by contract: it runs inside the `tools/pre-execute`
 * waterfall before every tool body, so anything but a plain value return would
 * fail calls it was never meant to touch. Non-shell tools, missing or
 * non-string commands, and every read-only shape answer `undefined`.
 * @param config - the live config fields the rule reads.
 * @param execution - the call about to run; only its name and arguments are read.
 * @returns the detected attempt, or `undefined` to leave the call alone.
 */
export function detectShellWrite(
  config: Pick<ResolvedConfig, 'baseUrl'>,
  execution: Pick<ToolExecution, 'name' | 'arguments'>,
): ShellWriteAttempt | undefined {
  const text = commandTextOf(execution)
  if (text === undefined) return undefined
  const aliases = authorityAliases(config.baseUrl)
  for (const shape of WRITE_SHAPES) {
    if (shape.test(text, aliases)) {
      return { reason: reasonOf(shape.label.en), displayReason: displayReasonOf(shape.label) }
    }
  }
  return undefined
}
