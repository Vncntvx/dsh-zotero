/** Globals provided by the browser fixture in smoke-parsed-ui.mjs. */
interface Window {
  fixtureReady: Promise<void>
  showFixture(mode: string, locale?: string): void
  chosen?: number
  selected?: string
  __parsedFullParses: number
  changeGeneration(): void
  failRefresh(): void
}
