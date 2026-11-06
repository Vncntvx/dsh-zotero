/**
 * The host protocol endpoint's one rejection reader. Both the Remote service
 * and the native launcher specs need the `RemoteError` fields, so the shape
 * lives here instead of being copied into each spec.
 * @module tests/host/support/open-protocol
 */
import { executeOpenProtocol } from '../../../src/remote.js'

/** The assertable slice of one `RemoteError` thrown by the protocol endpoint. */
export interface ProtocolRejection {
  readonly code?: string
  readonly details?: unknown
  readonly cause?: unknown
}

/**
 * Run one launch that must fail and return its rejection. A spec that passes
 * no options gets the Linux launcher, matching the native-launcher specs'
 * default environment.
 * @param url - the protocol URL to launch.
 * @param options - the platform and optional injected launcher.
 * @returns the `RemoteError` fields for assertion.
 * @throws Error when the launch unexpectedly succeeds.
 */
export async function rejectionOf(
  url: string,
  options?: Parameters<typeof executeOpenProtocol>[1],
): Promise<ProtocolRejection> {
  try {
    await executeOpenProtocol(url, options ?? { platform: 'linux' })
  } catch (error) {
    return error as ProtocolRejection
  }
  throw new Error(`expected ${url} to fail`)
}
