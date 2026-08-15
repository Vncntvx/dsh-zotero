/**
 * Settings namespace hosting the plugin's web-editable configuration section.
 *
 * The host half registers this namespace (with the `Config` schema and the
 * composition entry as its base layer) so the browser half's settings scope
 * can bind it and the settings document (`$DSH_HOME/settings.yaml`) can carry
 * a `zotero:` section. Kept in its own module — the browser bundle inlines
 * this one constant, and importing it from `service.js` would drag the whole
 * host implementation into the browser bundle.
 * @module dsh-zotero/settings-namespace
 */

/** Settings namespace of the plugin's configuration section. */
export const ZOTERO_SETTINGS_NAMESPACE = 'zotero'
