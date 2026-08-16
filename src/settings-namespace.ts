/**
 * Settings namespace hosting the plugin's web-editable configuration section.
 *
 * The host half registers this namespace (with the `Config` schema and the
 * composition entry as its base layer) so the settings document
 * (`$DSH_HOME/settings.yaml`) can carry a `zotero:` section, and the wire
 * contract (`contract.ts`) references the same constant for the Remote
 * namespace. Kept in its own module — it is dependency-free, so the browser
 * bundle can inline it without dragging in the host implementation.
 * @module dsh-zotero/settings-namespace
 */

/** Settings namespace of the plugin's configuration section. */
export const ZOTERO_SETTINGS_NAMESPACE = 'zotero'
