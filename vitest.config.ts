import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    // The published harness client packages ship their CSS modules and keep
    // their runtime third-party imports in `devDependencies` (the shell bundles
    // them). A registry install must be transformed here: left external, Node
    // loads `lib/index.js` directly and throws ERR_UNKNOWN_FILE_EXTENSION on
    // `.module.css`, while its bare imports need the devDependencies that
    // mirror them in this manifest.
    server: { deps: { inline: [/@deepseek-ai\/dsh-client-/] } },
    include: ['tests/**/*.spec.{ts,tsx}'],
    setupFiles: ['tests/client/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // The package entry is a pure re-export module; `src/types.ts`, the
      // sources domain model, and the ambient `css-modules.d.ts` are
      // types-only modules: none has runtime statements, so v8 reports them
      // as permanently uncovered. The global thresholds below are the gate;
      // per-file 100% is the aspiration, not the enforced bar.
      exclude: [
        'src/index.ts',
        'src/types.ts',
        'src/library/index.ts',
        'src/parsing/index.ts',
        'src/scholarly/index.ts',
        'src/scholarly/types.ts',
        'src/client/css-modules.d.ts',
        'src/client/build-info-globals.d.ts',
        'src/client/plugin-slots.d.ts',
        'src/client/deliverables-turn-data.d.ts',
        'src/sources/model.ts',
        'src/sources/block-types.ts',
        'src/session-projection/types.ts',
      ],
      // Thresholds are **ratchets per layer**, not aspirations: each number is
      // set just under what that layer measures today, so any drop fails while
      // no one is asked to write a test for a number's sake.
      //
      // One global average was the wrong instrument. `src/local` branches sat
      // at 94.82% while the global read 96.43% — a layer below its own gate,
      // hidden by layers far above it. The same averaging is what produced two
      // spec files named after the coverage they raised; the layers now carry
      // their own floor, and the two lowest are named in the open rather than
      // averaged away.
      //
      // Raising any of these is a separate decision with its own evidence: a
      // layer earns a higher floor by specifying more behavior, never by
      // touching branches to satisfy the number.
      //
      // Recalibrated when the /zotero command chain (command, session event,
      // projection, command card, command input) was removed: every deleted
      // module was fully covered, so the surviving code's own coverage is
      // unchanged while the layers lost that high-coverage mass. The floors
      // that moved were re-set just under the surviving layers' measured
      // values (global branches 94.92, src/*.ts branches 96.22 and functions
      // 98.59, client components branches 95.91).
      //
      // Recalibrated again when the source ledger moved out of the browser
      // graph to `src/sources`: the moved modules carry their own floor (the
      // old `src/client/sources` entry, renamed), and the surviving client
      // layer lost that mass, so its branch floor follows the same rule
      // (measured 95.90).
      //
      // Recalibrated after status-codec deduplication and domain simplification:
      // duplicate status codecs consolidated into wire schemas, resetting
      // layer ratchets to measured values (src/*.ts branches 95.8, src/local
      // statements/lines 97.8, src/client branches 95.2 and functions 96.9).
      //
      // Re-sited after the same simplification wave settled: the src/local
      // statement floor of 97.8 rounded ABOVE its own measurement (97.79), so
      // the floor failed its own gate by 0.01pp. Floors sit just under the
      // measured value, never on it: statements re-sited to 97.7.
      thresholds: {
        'src/*.ts': { statements: 98, branches: 95.8, functions: 98, lines: 98 },
        'src/local/**': { statements: 97.7, branches: 93, functions: 99, lines: 97.8 },
        'src/tools/**': { statements: 98, branches: 95, functions: 99, lines: 99 },
        'src/sources/**': { statements: 96, branches: 94, functions: 97, lines: 97 },
        // Component layer ratchets include both SourcesTab and the global Library components.
        'src/client/components/**': { statements: 95, branches: 95, functions: 99, lines: 97 },
        'src/client/**': { statements: 97, branches: 95.2, functions: 96.9, lines: 97 },
        'src/scholarly/**': { statements: 95, branches: 88, functions: 91, lines: 95 },
        // The parsing component is an optional subsystem with a live-network
        // transport and a filesystem store; its floors sit just under the
        // measured values, and the transport/store adapters are exercised
        // against a temp directory and a scripted client.
        'src/parsing/**': { statements: 93, branches: 85, functions: 98, lines: 95 },
        statements: 97,
        branches: 94,
        functions: 98,
        lines: 97,
      },
    },
  },
})
