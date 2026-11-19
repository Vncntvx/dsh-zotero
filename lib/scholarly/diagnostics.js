/**
 * Job-outcome diagnostics for the scholarly component.
 *
 * The component owns no recorder: the plugin's core service owns the single
 * bounded ring. This sink forwards each write to that recorder at call time,
 * so the scholarly job lifecycle lands in the same diagnostics surface as the
 * core heavy tools regardless of which component mounted first. A composition
 * without the core component gets a no-op sink.
 * @module dsh-zotero/scholarly/diagnostics
 */
/**
 * Build the scholarly job sink over the live core recorder.
 * @param ctx - the scholarly component's context.
 * @returns a sink whose writes follow whichever core service is mounted.
 */
export function scholarlyJobSink(ctx) {
    const sinkOf = () => ctx.get('zotero')?.diagnostics.sink;
    return {
        debug: (event, message, detail) => sinkOf()?.debug(event, message, detail),
        info: (event, message, detail) => sinkOf()?.info(event, message, detail),
        warn: (event, message, detail) => sinkOf()?.warn(event, message, detail),
        error: (event, message, detail) => sinkOf()?.error(event, message, detail),
    };
}
//# sourceMappingURL=diagnostics.js.map