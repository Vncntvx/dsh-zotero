/**
 * Ask for approval when static shell text describes a Local API write.
 * The scanner preserves quoted payloads and escaped separators, resolves literal
 * assignments, and joins raw socket pipelines. Addresses are canonicalized before
 * comparing ports, including short, numeric and mapped loopback spellings.
 *
 * This is a static detector. Script files, computed endpoints, environment values
 * absent from the command, and arbitrary binaries require the harness's execution
 * boundary; no shell text scanner can prove their network effects. run_code stays
 * outside this tool-name contract. Every terminal_send text is inspected because
 * a later Enter can execute text that was buffered without submit.
 * @module dsh-zotero/shell-write-detector
 */
import { LOOPBACK_HOSTNAMES } from './config.js';
import { ZOTERO_AUTHORIZE_PATH, ZOTERO_WRITE_TOOL_NAMES } from './constants.js';
import { asRecord, asString } from './json.js';
import { literalShellSegments, localAddressesIn } from './shell-command-scan.js';
/**
 * The tools whose command text this detector can read. `terminal_send` types
 * into a persistent shell, so its `text` is command text when the call submits
 * it; `run_code` is deliberately absent — its program can assemble any request
 * at runtime, exactly like `python -c`, and the module docs own that limit.
 */
export const SHELL_TOOL_NAMES = new Set(['bash', 'pwsh', 'terminal_send']);
/**
 * The endpoint that exists only to hand out a write key. Host-agnostic on
 * purpose only about *port*, like {@link USERS_WRITE}: the shape requires a
 * loopback host near the match, so an authorize call against
 * `api.zotero.org`, or any third-party host, is never mistaken for a local
 * one, while any loopback spelling still is.
 */
const AUTHORIZE_PATH = new RegExp(`/api/${ZOTERO_AUTHORIZE_PATH}\\b`, 'g');
/** An explicit method flag: `curl -X POST`, `--request=DELETE`, `-Method Post`. */
const EXPLICIT_METHOD = /(?:-X|--request|-Method)[\s=:]*['"]?(?:POST|PUT|PATCH|DELETE)\b/i;
/**
 * An HTTP client invocation, which is what makes a nearby flag a *write*
 * intent. HTTPie has a separate rule requiring an actual body field; the URL's
 * http scheme alone never identifies a client invocation.
 */
const WRITER_PROGRAM = /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i;
/**
 * curl's and wget's short body/upload flags, spelled case-sensitively: `-d`
 * (data), `-T` (upload-file), `-F` (form). Case-insensitivity here would make
 * `-D`, `-t`, and `-f` (`rm -f`, `grep -f`, `curl -f`) count as writes.
 */
const SHORT_WRITE_FLAG = /(?:^|[\s'"=])(?:-d|-T|-F)\b/;
/**
 * The unambiguous long spellings, case-insensitive so PowerShell's `-Body`
 * and `-InFile` are covered alongside curl's and wget's.
 */
const LONG_WRITE_FLAG = /(?:^|[\s'"=])(?:--data|--data-binary|--data-raw|--data-urlencode|--post-data|--post-file|--json|--upload-file|--form|-Body|-InFile)\b/i;
/** Any write-shaped flag, given a writer invocation. */
function hasWriteFlag(text) {
    return SHORT_WRITE_FLAG.test(text) || LONG_WRITE_FLAG.test(text);
}
/**
 * A method token spelled as an argument, as the `http`/`httpie` CLI takes it.
 * Global form is the scan copy `near` walks; the non-global twin stays the
 * readable spelling.
 */
const BARE_METHOD = /\b(?:POST|PUT|PATCH|DELETE)\b/g;
/** A client-library write call: `requests.post(`, `urlopen(... data=`, `.patch(`. */
const LIBRARY_WRITE = /\.(?:post|put|patch|delete)\s*\(/gi;
/**
 * A write to the Local API users path (`/api/users/<id>/…`), which is how
 * item, note, and collection writes are addressed. Host-agnostic on purpose
 * only about *port*: the shape still requires a loopback host near the match
 * (see {@link nearLoopback}), so a write against `api.zotero.org` is never
 * mistaken for a library write while `127.0.0.1:9999` still is.
 */
const USERS_WRITE = /(?:POST|PUT|PATCH|DELETE)\b[^|;&]{0,80}?\/api\/users\/\d+\//g;
/** Whether the text names the local API address in any of its loopback spellings. */
function namesAuthority(text, aliases) {
    if (aliases.length === 0)
        return false;
    const port = new URL(`http://${aliases[0]}`).port || '80';
    return localAddressesIn(text).some((url) => (url.port || (url.protocol === 'https:' ? '443' : '80')) === port);
}
/**
 * Whether the text names any loopback host. Distinct from
 * {@link namesAuthority}: that asks about the *configured* `host:port`, this
 * asks about loopback at all, which is what the users-path shape needs, so a
 * write on another loopback port is still a library write.
 */
function namesLoopback(text) {
    return localAddressesIn(text).length > 0;
}
/** Match throughout one logical command; long interpreter bodies retain their address. */
function near(text, pattern, aliases) {
    return text.matchAll(pattern).next().done === false && namesAuthority(text, aliases);
}
function nearLoopback(text, pattern) {
    return text.matchAll(pattern).next().done === false && namesLoopback(text);
}
/** Whether any shell step among `segments` matches `probe`. */
function anySegment(segments, probe) {
    return segments.some(probe);
}
/** The write-request label shared by the two spellings of the same shape. */
const LABEL_WRITE_REQUEST = {
    en: 'a write request to the local API address',
    zh: '对本地 API 地址的写请求',
};
/**
 * The matched shapes, most specific first. Each is deliberately anchored on
 * the configured local address, or on a loopback host beside the users path
 * or the authorize endpoint, so an unrelated `curl -d` against another
 * service is never mistaken for a library write.
 */
const WRITE_SHAPES = [
    {
        label: LABEL_WRITE_REQUEST,
        test: (segments, aliases) => anySegment(segments, (segment) => /(?:^|\s)(?:\S*\/)?https?\s+/.test(segment) &&
            namesAuthority(segment, aliases) &&
            !/\b(?:GET|HEAD|OPTIONS)\b/i.test(segment) &&
            /(?:^|\s)['"]?[A-Za-z_][\w.-]*(?:=(?!=)|:=|@)/.test(segment)),
    },
    {
        label: {
            en: 'the local-API authorize endpoint',
            zh: '本地 API 的授权端点（/api/local/authorize）',
        },
        // Loopback near the endpoint, not the configured port: the same shape
        // as the users path below, because authorize exists to mint a write key
        // and only a loopback host can be this library.
        test: (segments) => anySegment(segments, (segment) => nearLoopback(segment, AUTHORIZE_PATH)),
    },
    {
        label: LABEL_WRITE_REQUEST,
        test: (segments, aliases) => anySegment(segments, (segment) => namesAuthority(segment, aliases) &&
            WRITER_PROGRAM.test(segment) &&
            (EXPLICIT_METHOD.test(segment) || hasWriteFlag(segment))),
    },
    {
        label: LABEL_WRITE_REQUEST,
        test: (segments, aliases) => anySegment(segments, (segment) => near(segment, BARE_METHOD, aliases)),
    },
    {
        label: {
            en: 'a client-library write call to the local API address',
            zh: '对本地 API 地址的客户端库写调用',
        },
        test: (segments, aliases) => anySegment(segments, (segment) => near(segment, LIBRARY_WRITE, aliases)),
    },
    {
        label: {
            en: 'a write to the local users endpoint',
            zh: '对本地 users 端点的写请求',
        },
        // Loopback near the write, not the configured port: a users write on
        // 127.0.0.1:9999 is still this library, while the same shape against
        // api.zotero.org is not.
        test: (segments) => anySegment(segments, (segment) => nearLoopback(segment, USERS_WRITE)),
    },
];
/** The loopback spellings of the configured local API address.
 *
 * The cache belongs to the caller that owns the detector's lifetime (the
 * plugin fiber), never to this module: a process that mounts and unmounts
 * plugins must not accumulate spelling sets for addresses it no longer uses.
 * @param baseUrl - the resolved `baseUrl`.
 * @param cache - the owner's one-entry alias cache.
 * @returns the `host:port` spellings to match.
 */
function authorityAliases(baseUrl, cache) {
    const cached = cache.get(baseUrl);
    if (cached !== undefined)
        return cached;
    // `baseUrl` arrives from ResolvedConfig, which resolveConfig has already
    // proven parseable; an unparseable value must fail loudly here, not blind
    // the address-anchored shapes by silently matching nothing.
    const url = new URL(baseUrl);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const aliases = [...LOOPBACK_HOSTNAMES].map((host) => `${host}:${port}`);
    // One live baseUrl at a time: a rebuilt config starts a fresh entry and
    // drops the previous spelling set.
    cache.clear();
    cache.set(baseUrl, aliases);
    return aliases;
}
/**
 * The command text of a shell tool call, when the call carries one.
 *
 * `bash` and `pwsh` take a whole command in `command`. `terminal_send` writes
 * `text` into a running shell verbatim and appends Enter only when submitting,
 * so its text is scanned whether or not `submit` is set: an embedded control
 * character or a later empty-Enter call can execute it either way.
 * @param execution - the call about to run.
 * @returns the text to scan, or undefined when the call runs no command.
 */
function commandTextOf(execution) {
    if (!SHELL_TOOL_NAMES.has(execution.name))
        return undefined;
    const args = asRecord(execution.arguments);
    const command = execution.name === 'terminal_send' ? asString(args?.['text']) : asString(args?.['command']);
    return command !== undefined && command.trim() !== '' ? command : undefined;
}
/** The audit reason for one detected attempt. It is English, like every audit field. */
function reasonOf(label) {
    return [
        `a shell command runs ${label}, which would change the Zotero library outside the plugin`,
        `library writes go through ${ZOTERO_WRITE_TOOL_NAMES.join(', ')} only, where the user approves a plan first`,
        'this call needs an approval to run, and is denied when the user declines, when the session approval policy is "never", or when no approval channel is available',
    ].join('; ');
}
/**
 * The localized text the approval panel shows for one detected attempt. Both
 * arms are written in their own language: the label is translated rather than
 * interpolated from the English audit spelling.
 */
function displayReasonOf(label) {
    return {
        en: `Allow this command? It runs ${label.en}, changing your Zotero library directly through the local API, outside the plugin's write tools, so no plan is shown and no version checks apply. The plugin's write tools (${ZOTERO_WRITE_TOOL_NAMES.join(', ')}) are the reviewed route.`,
        zh: `允许这条命令吗？它执行的是${label.zh}，会绕过插件的写工具、直接通过本地接口修改你的 Zotero 文库，没有计划确认，也没有版本检查。插件的写工具（${ZOTERO_WRITE_TOOL_NAMES.join('、')}）才是经过确认的路径。`,
    };
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
 * @param aliases - the owner's alias cache; a caller without one recomputes.
 * @returns the detected attempt, or `undefined` to leave the call alone.
 */
export function detectShellWrite(config, execution, aliases = new Map()) {
    const text = commandTextOf(execution);
    if (text === undefined)
        return undefined;
    const authority = authorityAliases(config.baseUrl, aliases);
    // Every rule consumes the same static scan.
    const segments = literalShellSegments(text);
    for (const shape of WRITE_SHAPES) {
        if (shape.test(segments, authority)) {
            return { reason: reasonOf(shape.label.en), displayReason: displayReasonOf(shape.label) };
        }
    }
    return undefined;
}
//# sourceMappingURL=shell-write-detector.js.map