export interface RegistryPackage {
  name: string
  version: string
  dist: { integrity: string; tarball: string }
}
export function assertRegistryArtifact(
  metadata: RegistryPackage,
  manifest: { name: string; version: string },
  bytes: Uint8Array,
): void
export function registryVersion(
  name: string,
  version: string,
  options?: {
    fetchImpl?: typeof fetch
    delay?: (ms: number) => Promise<unknown>
    maxAttempts?: number
    delayMs?: number
    waitForPublication?: boolean
  },
): Promise<RegistryPackage | undefined>
export function registryTarball(
  metadata: RegistryPackage,
  manifest: { name: string; version: string },
  expectedBytes: Uint8Array,
  options?: {
    fetchImpl?: typeof fetch
    delay?: (ms: number) => Promise<unknown>
    maxAttempts?: number
    delayMs?: number
  },
): Promise<Buffer>
