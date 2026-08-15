import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The package entry is a pure re-export module: it has no runtime
      // statements, so v8 reports it as permanently uncovered. Every other
      // runtime-bearing source file must meet the 100% gate.
      exclude: ['src/index.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
