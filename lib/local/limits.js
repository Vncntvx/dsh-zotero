/**
 * The deployment-varying bounds the `local` provider reads from the resolved
 * config. Every member is a live read (or may be supplied as one), so a
 * settings commit applies on the next call without rebuilding the transport.
 * Declared apart from the provider class so every domain module can type its
 * dependencies without importing the facade.
 * @module dsh-zotero/local/limits
 */
export {};
//# sourceMappingURL=limits.js.map