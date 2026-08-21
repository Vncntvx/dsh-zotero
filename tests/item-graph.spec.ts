/**
 * Unit specs for the item-graph walk: classification of direct children,
 * the second-level annotation descent, bounded concurrency, and the
 * defensive branches (no attachments, keyless attachment, annotations off).
 * @module tests/item-graph
 */

import { describe, expect, it } from 'vitest'
import { loadItemGraph, type LoadItemGraphOptions } from '../src/item-graph.js'

function attachment(key: string): unknown {
  return { key, data: { itemType: 'attachment', contentType: 'application/pdf' } }
}

function annotation(key: string, sortIndex: string): unknown {
  return {
    key,
    data: { itemType: 'annotation', annotationText: key, annotationSortIndex: sortIndex },
  }
}

function note(key: string): unknown {
  return { key, data: { itemType: 'note', note: 'text' } }
}

/** A fetchChildren that maps keys to scripted rows and records every call. */
function scriptedRoutes(
  routes: Map<string, unknown[]>,
  calls: string[] = [],
): (key: string) => Promise<unknown[]> {
  return async (key) => {
    calls.push(key)
    const rows = routes.get(key)
    if (rows === undefined) throw new Error(`unexpected children request for ${key}`)
    return rows
  }
}

function load(
  routes: Map<string, unknown[]>,
  overrides: Partial<LoadItemGraphOptions> = {},
  calls: string[] = [],
) {
  return loadItemGraph({
    parentKey: 'PARENT000',
    fetchChildren: scriptedRoutes(routes, calls),
    concurrency: 4,
    withAnnotations: true,
    ...overrides,
  })
}

describe('loadItemGraph', () => {
  it('classifies direct children and descends into every attachment for annotations', async () => {
    const routes = new Map([
      ['PARENT000', [note('NOTE1111'), attachment('ATTA0001'), attachment('ATTA0002')]],
      ['ATTA0001', [annotation('ANNO0001', '00002')]],
      ['ATTA0002', [annotation('ANNO0002', '00001'), note('NESTED001')]],
    ])
    const graph = await load(routes)
    expect(graph.childRows.map((row) => (row as { key: string }).key)).toEqual([
      'NOTE1111',
      'ATTA0001',
      'ATTA0002',
    ])
    expect(graph.attachments.map((node) => node.row)).toHaveLength(2)
    // Nested notes under attachments are not annotations; they are ignored.
    expect(graph.attachmentAnnotations.map((row) => (row as { key: string }).key)).toEqual([
      'ANNO0001',
      'ANNO0002',
    ])
  })

  it('keeps legacy direct annotation rows in childRows without re-fetching them', async () => {
    const routes = new Map([['PARENT000', [annotation('ANNO0001', '00001')]]])
    const graph = await load(routes)
    expect(graph.attachments).toEqual([])
    expect(graph.attachmentAnnotations).toEqual([])
    expect(graph.childRows).toHaveLength(1)
  })

  it('skips the second level entirely when withAnnotations is false', async () => {
    const routes = new Map([
      ['PARENT000', [attachment('ATTA0001')]],
      ['ATTA0001', [annotation('ANNO0001', '00001')]],
    ])
    const calls: string[] = []
    const graph = await load(routes, { withAnnotations: false }, calls)
    expect(calls).toEqual(['PARENT000'])
    expect(graph.attachments[0]?.annotations).toEqual([])
    expect(graph.attachmentAnnotations).toEqual([])
  })

  it('skips the second level when no direct child is an attachment', async () => {
    const routes = new Map([['PARENT000', [note('NOTE1111')]]])
    const calls: string[] = []
    const graph = await load(routes, {}, calls)
    expect(calls).toEqual(['PARENT000'])
    expect(graph.attachmentAnnotations).toEqual([])
  })

  it('does not fail the graph when an attachment row has no traversable key', async () => {
    const routes = new Map([
      ['PARENT000', [{ data: { itemType: 'attachment' } }, attachment('ATTA0001')]],
      ['ATTA0001', [annotation('ANNO0001', '00001')]],
    ])
    const graph = await load(routes)
    expect(graph.attachments[0]?.annotations).toEqual([])
    expect(graph.attachments[1]?.annotations.map((row) => (row as { key: string }).key)).toEqual([
      'ANNO0001',
    ])
  })

  it('caps in-flight attachment requests at the configured concurrency', async () => {
    const keys = Array.from({ length: 8 }, (_, i) => `ATTA${String(i).padStart(4, '0')}`)
    const routes = new Map<string, unknown[]>([
      ['PARENT000', keys.map((key) => attachment(key))],
      ...keys.map((key): [string, unknown[]] => [
        key,
        [annotation(`ANNO${key.slice(4)}`, '00001')],
      ]),
    ])
    let inFlight = 0
    let peak = 0
    const graph = await loadItemGraph({
      parentKey: 'PARENT000',
      fetchChildren: async (key) => {
        if (key === 'PARENT000') return routes.get(key)!
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        return routes.get(key)!
      },
      concurrency: 2,
      withAnnotations: true,
    })
    expect(peak).toBe(2)
    expect(graph.attachmentAnnotations).toHaveLength(8)
  })

  it('propagates a failed attachment fetch and stops starting further walks', async () => {
    const routes = new Map<string, unknown[]>([
      ['PARENT000', [attachment('ATTA0001'), attachment('ATTA0002')]],
      ['ATTA0001', []],
    ])
    await expect(load(routes)).rejects.toThrow('unexpected children request for ATTA0002')
  })
})
