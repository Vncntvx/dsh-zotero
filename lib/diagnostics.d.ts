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
/** Severity of a diagnostic entry, ordered from most to least verbose. */
export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';
/**
 * The logger-name root every plugin-owned logger carries. The exporter
 * matches this root in both spellings Cordis produces: the explicit names
 * the plugin's seams choose (`zotero.http`), and the fiber-derived
 * hyphenated name (`zotero-service`) under which an unnamed `ctx.logger`
 * access (and with it this fiber's own lifecycle failures) is reported.
 */
export declare const DIAGNOSTIC_LOG_PREFIX = "zotero";
/** Structured facts attached to one entry. Values are primitives only: the wire view is strict JSON. */
export type DiagnosticDetail = Record<string, string | number | boolean>;
/** What a seam emits. The recorder stamps `seq`/`ts` and owns truncation. */
export interface DiagnosticPushInput {
    readonly level: DiagnosticLevel;
    readonly event: string;
    readonly message: string;
    readonly detail?: DiagnosticDetail;
}
/** The single logging surface every instrumented seam receives. All methods are safe no-ops below the recorder threshold. */
export interface DiagnosticSink {
    debug(event: string, message: string, detail?: DiagnosticDetail): void;
    info(event: string, message: string, detail?: DiagnosticDetail): void;
    warn(event: string, message: string, detail?: DiagnosticDetail): void;
    error(event: string, message: string, detail?: DiagnosticDetail): void;
}
/** One retained diagnostic. `count` coalesces consecutive repeats of the same `(event, level, message)`. */
export interface DiagnosticEntry {
    readonly seq: number;
    readonly ts: number;
    readonly level: DiagnosticLevel;
    readonly event: string;
    readonly message: string;
    readonly count: number;
    readonly detail?: DiagnosticDetail;
}
/** Newest-first view of the ring, as the remote `diagnostics` endpoint serves it. */
export interface DiagnosticsSnapshot {
    readonly entries: readonly DiagnosticEntry[];
    /** Entries currently retained (after capacity eviction, before the snapshot limit). */
    readonly total: number;
    /** Whether `entries` was cut to the caller's limit. */
    readonly truncated: boolean;
}
/** Upper bound on entries held in memory; the oldest are evicted first. */
export declare const DIAGNOSTIC_RING_CAPACITY = 500;
/** Upper bound on one entry's message, so a pathological seam cannot dominate the buffer. The remote layer pre-clamps client crash-report text to this. */
export declare const DIAGNOSTIC_MESSAGE_MAX_CHARS = 500;
/** Upper bound on one detail value (and one detail key). Stacks and component stacks are pre-clamped to this by the remote layer. */
export declare const DIAGNOSTIC_DETAIL_VALUE_MAX_CHARS = 1000;
/**
 * Whether a logger name belongs to this plugin's subtree. Cordis logger
 * names are flat strings with no hierarchy, and two spellings occur: the
 * explicit names the plugin's seams choose (`zotero.http`), and the
 * fiber-derived name an unnamed `ctx.logger.error` produces, the plugin
 * class name hyphenated (`zotero-service`), the spelling under which Cordis
 * reports this fiber's own lifecycle failures.
 */
export declare function loggerNameMatches(name: string): boolean;
/**
 * Clamp one string to a bound, marking the cut with an ellipsis. Shared with
 * the remote layer, which applies the same bounds to client-supplied crash
 * text before the ring's own clamps see it.
 */
export declare function clampText(value: string, max: number): string;
/** A structural slice of the Cordis logger `Message`, kept local so this module stays dependency-free. */
export interface DiagnosticLogMessage {
    readonly name: string;
    readonly type: string;
    readonly args: readonly unknown[];
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
export declare function logMessageToPush(message: DiagnosticLogMessage): DiagnosticPushInput;
/**
 * The bounded record itself. Pushes are O(1): append, coalesce a consecutive
 * repeat of the same `(event, level, message)` into a `count` bump (a hot
 * error loop must not wash out the rest of the buffer), then evict the
 * oldest past capacity. The coalesced entry keeps its original sequence
 * number and first detail; only `count` and `ts` advance.
 */
export declare class DiagnosticsRing {
    private readonly capacity;
    private entries;
    private seqCounter;
    constructor(capacity?: number);
    /**
     * Record one entry, clamped and coalesced.
     * @param input - the seam's emission, unbounded.
     * @returns the entry's sequence number (the coalesced entry keeps its original).
     */
    push(input: DiagnosticPushInput): number;
    /**
     * Newest-first view of the retained entries.
     * @param limit - upper bound on returned entries; defaults to everything retained.
     * @returns the snapshot with `total`/`truncated` facts.
     */
    snapshot(limit?: number): DiagnosticsSnapshot;
}
/**
 * The recorder the service owns: the threshold gate, the stable sink the
 * seams hold, and the push/snapshot face the remote endpoints delegate to.
 * The sink reads the threshold live, so a settings-page `debug` flip applies
 * to the very next emission without rebuilding anything.
 */
export declare class DiagnosticsRecorder {
    private readonly ring;
    private threshold;
    private readonly boundSink;
    constructor(capacity?: number);
    /** The stable sink handed to every instrumented seam. */
    get sink(): DiagnosticSink;
    /**
     * Raise or lower the retention gate. `info` keeps state transitions visible
     * while dropping per-request detail; `debug` admits everything.
     */
    setThreshold(level: DiagnosticLevel): void;
    /**
     * Whether an emission at this level would be retained right now. Hot seams
     * consult this before building debug-only payloads (the tool-call digest
     * JSON-stringifies arbitrary arguments), so the construction cost is paid
     * only when the entry can actually be admitted.
     */
    admits(level: DiagnosticLevel): boolean;
    /**
     * Record an entry directly, bypassing the threshold (used by the exporter
     * tap and the client-error endpoint, which decide their own admission).
     * @param input - the emission, unbounded.
     * @returns the entry's sequence number.
     */
    push(input: DiagnosticPushInput): number;
    /**
     * Newest-first snapshot for the remote endpoint.
     * @param limit - upper bound on returned entries.
     * @returns the snapshot with `total`/`truncated` facts.
     */
    snapshot(limit?: number): DiagnosticsSnapshot;
}
//# sourceMappingURL=diagnostics.d.ts.map