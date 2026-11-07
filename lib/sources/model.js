/**
 * The session source model: the domain vocabulary of the Sources panel. One
 * `SourceItem` aggregates everything the session proved about one library
 * item; only settled, successful, structurally valid tool calls produce
 * facts. Running, failed, and stopped calls count into `operations` and are
 * never rendered as achievements. The model carries no harness execution
 * objects (no tool-call blocks); call-level diagnostics stay with the
 * built-in Trajectory view.
 * @module dsh-zotero/client/sources/model
 */
export {};
//# sourceMappingURL=model.js.map