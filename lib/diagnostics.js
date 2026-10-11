/**
 * Plugin-owned diagnostics: a bounded in-memory record of what the plugin
 * did and where it degraded, readable from the web client over the `zotero`
 * remote namespace.
 *
 * The harness's own logger output is invisible by default (no exporter is
 * mounted anywhere, so messages only reach an unreachable ring buffer), and
 * the plugin's failure seams (degraded listings, refused writes, job
 * failures, render crashes reported by the client) otherwise leave nothing a
 * reader can inspect. A {@link DiagnosticsRing} fed through the
 * {@link DiagnosticSink} surface closes that gap:
 *
 * - explicit seam logging (`sink.warn('write.gate', …)`) at the call sites
 *   catalogued in `docs/architecture.md`; and
 * - one process-wide logger exporter (mounted in `service.ts`) that filters
 *   this plugin's own logger names and captures whatever else the subtree
 *   emits, lifecycle failures included.
 *
 * Everything stays in process memory: no file sink, no external transport,
 * and no credential ever passes through a seam. Entries are wire-shaped
 * (optional fields are simply absent, strings are pre-truncated), so the
 * strict remote codec can consume a snapshot as-is.
 * @module dsh-zotero/diagnostics
 */
/** Numeric rank of each level; an entry is retained when its rank is at or above the recorder threshold. */
const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };
/**
 * The logger-name root every plugin-owned logger carries. The exporter
 * matches this root in both spellings Cordis produces: the explicit names
 * the plugin's seams choose (`zotero.http`), and the fiber-derived
 * hyphenated name (`zotero-service`) under which an unnamed `ctx.logger`
 * access (and with it this fiber's own lifecycle failures) is reported.
 */
export const DIAGNOSTIC_LOG_PREFIX = 'zotero';
/** Upper bound on entries held in memory; the oldest are evicted first. */
export const DIAGNOSTIC_RING_CAPACITY = 500;
/** Upper bound on one entry's message, so a pathological seam cannot dominate the buffer. The remote layer pre-clamps client crash-report text to this. */
export const DIAGNOSTIC_MESSAGE_MAX_CHARS = 500;
/** Upper bound on detail fields per entry. */
const DETAIL_MAX_FIELDS = 8;
/** Upper bound on one detail value (and one detail key). Stacks and component stacks are pre-clamped to this by the remote layer. */
export const DIAGNOSTIC_DETAIL_VALUE_MAX_CHARS = 1000;
/** Logger `type` values the ring's levels accept; anything else maps to `info`. */
const LOGGER_TYPES = ['error', 'warn', 'info', 'debug'];
/**
 * Whether a logger name belongs to this plugin's subtree. Cordis logger
 * names are flat strings with no hierarchy, and two spellings occur: the
 * explicit names the plugin's seams choose (`zotero.http`), and the
 * fiber-derived name an unnamed `ctx.logger.error` produces, the plugin
 * class name hyphenated (`zotero-service`), the spelling under which Cordis
 * reports this fiber's own lifecycle failures.
 */
export function loggerNameMatches(name) {
    return (name === DIAGNOSTIC_LOG_PREFIX ||
        name.startsWith(`${DIAGNOSTIC_LOG_PREFIX}.`) ||
        name.startsWith(`${DIAGNOSTIC_LOG_PREFIX}-`));
}
/**
 * Clamp one string to a bound, marking the cut with an ellipsis. Shared with
 * the remote layer, which applies the same bounds to client-supplied crash
 * text before the ring's own clamps see it.
 */
export function clampText(value, max) {
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
/** JSON.stringify that never throws (cyclic or hostile structures degrade to `String(value)`). */
function safeSerialize(value) {
    try {
        return JSON.stringify(value) ?? String(value);
    }
    catch {
        return String(value);
    }
}
/** One thrown/printed value as a bounded detail value; primitives pass through untouched. */
function detailValueOf(value) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (value instanceof Error)
        return `${value.name}: ${value.message}`;
    return safeSerialize(value);
}
/** Clamp a detail map to the entry bounds: at most `DETAIL_MAX_FIELDS` fields, each key and value bounded. */
function clampDetail(detail) {
    const clamped = {};
    for (const [key, value] of Object.entries(detail).slice(0, DETAIL_MAX_FIELDS)) {
        clamped[clampText(key, DIAGNOSTIC_DETAIL_VALUE_MAX_CHARS)] =
            typeof value === 'string' ? clampText(value, DIAGNOSTIC_DETAIL_VALUE_MAX_CHARS) : value;
    }
    return clamped;
}
/**
 * Adapt one captured logger message to a ring input. The first argument
 * carries the message (an `Error` contributes its code, when it has one, as
 * an `errorCode` detail); further arguments become `argN` details. The
 * logger's own name rides along whenever it is more specific than the bare
 * plugin root, so lifecycle failures stay attributable.
 * @param message - the exporter's captured message.
 * @returns the ring input, with an unknown logger type mapped to `info`.
 */
export function logMessageToPush(message) {
    const level = LOGGER_TYPES.includes(message.type)
        ? message.type
        : 'info';
    const [first, ...rest] = message.args;
    const detail = {};
    if (message.name !== DIAGNOSTIC_LOG_PREFIX) {
        detail.logger = message.name;
    }
    let text;
    if (first instanceof Error) {
        text = `${first.name}: ${first.message}`;
        const code = first.code;
        if (typeof code === 'string' && code !== '') {
            detail.errorCode = code;
        }
    }
    else if (typeof first === 'string') {
        text = first;
    }
    else if (first === undefined) {
        text = '';
    }
    else {
        text = safeSerialize(first);
    }
    for (const [index, arg] of rest
        .slice(0, DETAIL_MAX_FIELDS - Object.keys(detail).length)
        .entries()) {
        detail[`arg${index + 1}`] = detailValueOf(arg);
    }
    const hasDetail = Object.keys(detail).length > 0;
    return { level, event: 'lifecycle', message: text, ...(hasDetail ? { detail } : {}) };
}
/**
 * The bounded record itself. Pushes are O(1): append, coalesce a consecutive
 * repeat of the same `(event, level, message)` into a `count` bump (a hot
 * error loop must not wash out the rest of the buffer), then evict the
 * oldest past capacity. The coalesced entry keeps its original sequence
 * number and first detail; only `count` and `ts` advance.
 */
export class DiagnosticsRing {
    capacity;
    entries = [];
    seqCounter = 0;
    constructor(capacity = DIAGNOSTIC_RING_CAPACITY) {
        this.capacity = capacity;
    }
    /**
     * Record one entry, clamped and coalesced.
     * @param input - the seam's emission, unbounded.
     * @returns the entry's sequence number (the coalesced entry keeps its original).
     */
    push(input) {
        const last = this.entries[this.entries.length - 1];
        if (last !== undefined &&
            last.event === input.event &&
            last.level === input.level &&
            last.message === input.message) {
            const coalesced = { ...last, count: last.count + 1, ts: Date.now() };
            this.entries[this.entries.length - 1] = coalesced;
            return coalesced.seq;
        }
        const entry = {
            seq: ++this.seqCounter,
            ts: Date.now(),
            level: input.level,
            event: input.event,
            message: clampText(input.message, DIAGNOSTIC_MESSAGE_MAX_CHARS),
            count: 1,
            ...(input.detail === undefined ? {} : { detail: clampDetail(input.detail) }),
        };
        this.entries.push(entry);
        if (this.entries.length > this.capacity) {
            this.entries = this.entries.slice(-this.capacity);
        }
        return entry.seq;
    }
    /**
     * Newest-first view of the retained entries.
     * @param limit - upper bound on returned entries; defaults to everything retained.
     * @returns the snapshot with `total`/`truncated` facts.
     */
    snapshot(limit = this.entries.length) {
        const newestFirst = [...this.entries].reverse();
        return {
            entries: newestFirst.slice(0, limit),
            total: this.entries.length,
            truncated: newestFirst.length > limit,
        };
    }
}
/**
 * The recorder the service owns: the threshold gate, the stable sink the
 * seams hold, and the push/snapshot face the remote endpoints delegate to.
 * The sink reads the threshold live, so a settings-page `debug` flip applies
 * to the very next emission without rebuilding anything.
 */
export class DiagnosticsRecorder {
    ring;
    threshold = 'info';
    boundSink;
    constructor(capacity = DIAGNOSTIC_RING_CAPACITY) {
        this.ring = new DiagnosticsRing(capacity);
        const emit = (level) => {
            return (event, message, detail) => {
                if (LEVEL_RANK[level] < LEVEL_RANK[this.threshold])
                    return;
                this.ring.push({ level, event, message, ...(detail === undefined ? {} : { detail }) });
            };
        };
        this.boundSink = {
            debug: emit('debug'),
            info: emit('info'),
            warn: emit('warn'),
            error: emit('error'),
        };
    }
    /** The stable sink handed to every instrumented seam. */
    get sink() {
        return this.boundSink;
    }
    /**
     * Raise or lower the retention gate. `info` keeps state transitions visible
     * while dropping per-request detail; `debug` admits everything.
     */
    setThreshold(level) {
        this.threshold = level;
    }
    /**
     * Whether an emission at this level would be retained right now. Hot seams
     * consult this before building debug-only payloads (the tool-call digest
     * JSON-stringifies arbitrary arguments), so the construction cost is paid
     * only when the entry can actually be admitted.
     */
    admits(level) {
        return LEVEL_RANK[level] >= LEVEL_RANK[this.threshold];
    }
    /**
     * Record an entry directly, bypassing the threshold (used by the exporter
     * tap and the client-error endpoint, which decide their own admission).
     * @param input - the emission, unbounded.
     * @returns the entry's sequence number.
     */
    push(input) {
        return this.ring.push(input);
    }
    /**
     * Newest-first snapshot for the remote endpoint.
     * @param limit - upper bound on returned entries.
     * @returns the snapshot with `total`/`truncated` facts.
     */
    snapshot(limit) {
        return this.ring.snapshot(limit);
    }
}
//# sourceMappingURL=diagnostics.js.map