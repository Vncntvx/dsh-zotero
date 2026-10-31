/**
 * @module dsh-zotero/service-config
 */
import type { ResolvedConfig } from './config.js';
import type { LocalApiLimits } from './local/limits.js';
/**
 * Top-level config keys whose change rebuilds the transport stack: the HTTP
 * client identity and bounds (`baseUrl`, `timeoutMs`, `maxResponseBytes`,
 * `maxInFlightRequests`, the last of which sizes the client-wide concurrency
 * gate), the write client's human-scale dialog budget
 * (`writeAuthorizeDeadlineMs`), and the write-capability flip (writer,
 * authorizer, and tool set). `provider` and `writePersistKey` are live reads
 * (`resolveProvider()` and the authorizer's `persistKey` callback) and never
 * rebuild; every remaining bound, the scope-listing TTL included, is read
 * through the provider's live limits getter on the next call.
 */
export declare const TRANSPORT_CONFIG_KEYS: ReadonlySet<keyof ResolvedConfig>;
export declare function touchesTransport(paths: readonly (readonly string[])[]): boolean;
export declare function sameTransportConfig(current: ResolvedConfig, built: ResolvedConfig): boolean;
export declare function localProviderLimits(config: ResolvedConfig): LocalApiLimits;
//# sourceMappingURL=service-config.d.ts.map