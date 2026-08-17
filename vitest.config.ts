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
      // as permanently uncovered. Every other runtime-bearing source file
      // must meet the 100% gate.
      exclude: [
        'src/index.ts',
        'src/types.ts',
        'src/client/css-modules.d.ts',
        'src/client/sources/model.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
