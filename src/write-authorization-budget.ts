/** Foreground authorization prompts share Zotero's five-per-minute rolling budget. */
import { setTimeout as wait } from 'node:timers/promises'

export class WriteAuthorizationBudget {
  private timestamps: number[] = []
  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly pause: (milliseconds: number, signal?: AbortSignal) => Promise<void> = async (
      milliseconds,
      signal,
    ) => {
      await wait(milliseconds, undefined, { signal })
    },
  ) {}

  async reserve(signal?: AbortSignal): Promise<void> {
    for (;;) {
      signal?.throwIfAborted()
      const current = this.now()
      this.timestamps = this.timestamps.filter((time) => current - time < 60_000)
      if (this.timestamps.length < 5) {
        this.timestamps.push(current)
        return
      }
      await this.pause(Math.max(1, this.timestamps[0]! + 60_000 - current), signal)
    }
  }
}
