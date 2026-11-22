/** Foreground authorization prompts share Zotero's five-per-minute rolling budget. */
import { setTimeout as wait } from 'node:timers/promises';
export class WriteAuthorizationBudget {
    now;
    pause;
    timestamps = [];
    constructor(now = () => performance.now(), pause = async (milliseconds, signal) => {
        await wait(milliseconds, undefined, { signal });
    }) {
        this.now = now;
        this.pause = pause;
    }
    async reserve(signal) {
        for (;;) {
            signal?.throwIfAborted();
            const current = this.now();
            this.timestamps = this.timestamps.filter((time) => current - time < 60_000);
            if (this.timestamps.length < 5) {
                this.timestamps.push(current);
                return;
            }
            await this.pause(Math.max(1, this.timestamps[0] + 60_000 - current), signal);
        }
    }
}
//# sourceMappingURL=write-authorization-budget.js.map