/**
 * The temporary roots and download managers the enrichment model specs share.
 *
 * Every spec used to carry its own `roots[]`, `managers[]`, `releases[]` and an
 * `afterEach` that released in a fixed order — release, dispose, `rm`. The
 * order is part of the tests' correctness (a manager still pumping a transfer
 * would recreate a directory the sweep just removed), so it lives here once.
 * @module tests/host/enrichment/support/model-sandbox
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelDownloadManager } from '../../../../src/enrichment/model-downloader.ts'

/** One spec's sandbox: owns what it creates and tears it down in order. */
export interface ModelSandbox {
  /** A fresh temporary root, removed by {@link ModelSandbox.settle}. */
  root(): Promise<string>
  /** Register a manager for disposal; returned for chaining. */
  manager<T extends ModelDownloadManager>(manager: T): T
  /** Register a producer release to run before managers are disposed. */
  release(release: () => void): void
  /** Release producers, dispose managers, then remove every root. */
  settle(): Promise<void>
}

/**
 * Create the sandbox for one spec file.
 * @param prefix - the temporary-directory prefix, so a leaked root names its spec.
 * @returns the sandbox.
 */
export function createModelSandbox(prefix: string): ModelSandbox {
  const roots: string[] = []
  const managers: ModelDownloadManager[] = []
  const releases: Array<() => void> = []

  return {
    async root() {
      const root = await mkdtemp(join(tmpdir(), prefix))
      roots.push(root)
      return root
    },
    manager(manager) {
      managers.push(manager)
      return manager
    },
    release(release) {
      releases.push(release)
    },
    async settle() {
      // A producer that is still running would recreate what the sweep
      // removes, so it is released first.
      for (const release of releases.splice(0)) release()
      await Promise.all(managers.splice(0).map(async (manager) => await manager.dispose()))
      await Promise.all(
        roots.splice(0).map(async (root) => {
          await rm(root, { recursive: true, force: true })
        }),
      )
    },
  }
}
