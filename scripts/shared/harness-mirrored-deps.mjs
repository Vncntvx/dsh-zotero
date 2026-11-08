/**
 * The third-party dependency set the browser bundle mirrors from the sibling
 * harness's `packages/client/*` declarations. These move with the harness
 * pin, never on their own: `scripts/deps-check.mjs` excludes them from
 * registry freshness, and `scripts/harness-state.mjs` gates their floors
 * against the pin tag. One list, two consumers — a second copy here would let
 * the two checks drift apart silently.
 * @module scripts/shared/harness-mirrored-deps
 */

export const HARNESS_MIRRORED = new Set([
  '@lexical/headless',
  '@lexical/history',
  '@lexical/plain-text',
  '@lexical/text',
  '@lexical/utils',
  '@shikijs/langs',
  '@tanstack/react-virtual',
  '@types/react',
  'anser',
  'clsx',
  'diff',
  'fast-xml-parser',
  'immer',
  'katex',
  'lexical',
  'mdast-util-from-markdown',
  'mdast-util-gfm',
  'mdast-util-math',
  'micromark-core-commonmark',
  'micromark-extension-gfm',
  'micromark-extension-math',
  'micromark-factory-space',
  'micromark-util-character',
  'micromark-util-classify-character',
  'micromark-util-sanitize-uri',
  'micromark-util-symbol',
  'micromark-util-types',
  'react',
  'react-dom',
  'shiki',
  'simple-icons',
  'use-sync-external-store',
  'zod',
  'zustand',
])
