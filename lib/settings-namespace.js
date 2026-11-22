/**
 * Settings namespace hosting the plugin's web-editable configuration section.
 *
 * The installed bundle declares its profile entry as `zotero` (carrying the
 * `Config` schema, with the composition entry as its base layer), so the
 * harness settings forms address the section by this id and persist edits
 * into the active profile's Cordis patch (`cordis.patch.yml`). The wire
 * contract (`src/contract.ts`) references the same constant for the Remote
 * namespace. It is kept in its own module because it is dependency-free, so
 * the browser bundle can inline it without dragging in the host
 * implementation or host-only Typert codecs.
 * @module dsh-zotero/settings-namespace
 */
/** Settings namespace of the plugin's configuration section. */
export const ZOTERO_SETTINGS_NAMESPACE = 'zotero';
/** Settings namespace of the scholarly component's configuration section. */
export const SCHOLARLY_SETTINGS_NAMESPACE = 'scholarly';
/** Settings namespace of the document-enrichment component's configuration section. */
export const ENRICHMENT_SETTINGS_NAMESPACE = 'enrichment';
/**
 * The wire service key the enrichment component's remote endpoints answer on.
 * Declared in the core's Typert manifest like the library service's, but the
 * receiver is this component's Cordis service, so the endpoints exist only
 * while the row is composed.
 */
export const ZOTERO_ENRICHMENT_SERVICE_KEY = 'enrichment';
//# sourceMappingURL=settings-namespace.js.map