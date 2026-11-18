export interface HarnessToolchain {
  pin: string
  commit: string
  packageManager: string
}
export const toolchainFixture: URL
export const consumerManifestPath: string
export const consumerLockPath: string
export function pnpmVersion(packageManager: unknown): string
export function consumerDependencies(
  pin: string,
  fixture: HarnessToolchain,
): { '@deepseek-ai/dsh': string; pnpm: string }
export function consumerProblems(
  manifest: { dependencies?: Record<string, string | undefined> } | undefined,
  lock:
    | {
        packages?: Record<
          string,
          { dependencies?: Record<string, string | undefined>; version?: string } | undefined
        >
      }
    | undefined,
  pin: string,
  fixture: HarnessToolchain,
): string[]
export function extractHarnessToolchain(harnessRoot: string, pin: string): HarnessToolchain
export function readHarnessToolchain(harnessRoot: string, pin: string): HarnessToolchain
