import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    setupFiles: ['tests/client/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // The package entry is a pure re-export module; `types.ts`, the
      // sources domain model, and the ambient `css-modules.d.ts` are
      // types-only modules: none has runtime statements, so v8 reports them
      // as permanently uncovered. The global thresholds below are the gate;
      // per-file 100% is the aspiration, not the enforced bar.
      exclude: [
        'src/index.ts',
        'src/types.ts',
        'src/client/css-modules.d.ts',
        'src/client/build-info-globals.d.ts',
        'src/client/plugin-slots.d.ts',
        'src/client/sources/model.ts',
        'src/client/components/plugin/types.ts',
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
      thresholds: {
        'src/*.ts': { statements: 98, branches: 97, functions: 99, lines: 98 },
        'src/local/**': { statements: 98, branches: 93, functions: 99, lines: 98 },
        'src/tools/**': { statements: 98, branches: 95, functions: 99, lines: 99 },
        'src/client/sources/**': { statements: 96, branches: 94, functions: 97, lines: 97 },
        // The weakest layer, and the reason a single global number hid the
        // shape of the suite: UI rendering leaves branches that only a test
        // written to touch them would reach.
        'src/client/components/**': { statements: 91, branches: 92, functions: 99, lines: 93 },
        'src/client/**': { statements: 97, branches: 96, functions: 97, lines: 97 },
        statements: 97,
        branches: 95,
        functions: 98,
        lines: 97,
      },
    },
  },
})
