export interface HarnessToolchain {
  pin: string
  commit: string
  packageManager: string
}
export const toolchainFixture: URL
export function pnpmVersion(packageManager: unknown): string
export function installCommand(pin: string, fixture: HarnessToolchain): string
export function extractHarnessToolchain(harnessRoot: string, pin: string): HarnessToolchain
export function readHarnessToolchain(harnessRoot: string, pin: string): HarnessToolchain
