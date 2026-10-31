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
export declare const ZOTERO_SETTINGS_NAMESPACE = "zotero";
/** Settings namespace of the scholarly component's configuration section. */
export declare const SCHOLARLY_SETTINGS_NAMESPACE = "scholarly";
//# sourceMappingURL=settings-namespace.d.ts.map