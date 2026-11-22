/**
 * The session source model: the domain vocabulary of the Sources panel. One
 * `SourceItem` aggregates everything the session proved about one library
 * item; only settled, successful, structurally valid tool calls produce
 * facts. Running, failed, and stopped calls count into `operations` and are
 * never rendered as achievements. The model carries no harness execution
 * objects (no tool-call blocks); call-level diagnostics stay with the
 * built-in Trajectory view.
 * @module dsh-zotero/sources/model
 */
/**
 * The one acceptance rule for a local library argument: the personal library
 * (`user/0`) or a positive safe-integer group. It is shared by the tool
 * surface's detailed validator and the ledger's search identity, so a call the
 * tool accepts is the call the trail attributes.
 * @param value - the raw `library` argument.
 * @returns the supported library, or undefined for absent/unsupported shapes.
 */
export function supportedLocalLibraryOf(value) {
    if (value === null || typeof value !== 'object')
        return undefined;
    const { type, id } = value;
    if (type === 'user' && id === 0)
        return { type: 'user', id: 0 };
    if (type === 'group' && typeof id === 'number' && Number.isSafeInteger(id) && id > 0) {
        return { type: 'group', id };
    }
    return undefined;
}
//# sourceMappingURL=model.js.map