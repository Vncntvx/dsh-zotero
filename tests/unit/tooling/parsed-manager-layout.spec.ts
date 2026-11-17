/**
 * The parsed manager's row anatomy, asserted against its stylesheet: the state
 * pills keep their top breathing room, adjacent rows own a hairline boundary,
 * and the three row actions never leave the metadata line. jsdom has no layout,
 * so these invariants are read from the CSS the bundle ships.
 * @module tests/unit/tooling/parsed-manager-layout
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { declarationsOf, rulesOf, stripComments } from '../../../scripts/style-guard.mjs'

const CSS = stripComments(
  readFileSync(
    new URL('../../../src/client/enrichment/parsed-manager.module.css', import.meta.url),
    'utf8',
  ),
)
const RULES = rulesOf(CSS)

interface Rule {
  readonly selector: string
  readonly body: string
  readonly atRules: readonly string[]
}

function ruleOf(selector: string): Rule {
  const found = RULES.find(
    (rule: Rule) => rule.selector.replace(/\s+/g, '') === selector.replace(/\s+/g, ''),
  )
  expect(found, `no rule for ${selector}`).toBeDefined()
  return found!
}

function declarationOf(selector: string, property: string): string | undefined {
  return declarationsOf(ruleOf(selector).body).find(
    (declaration: { property: string }) => declaration.property === property,
  )?.value
}

describe('parsed manager row anatomy', () => {
  it('gives the state pills room above and a rule below the filter band', () => {
    expect(declarationOf('.filters', 'padding-top')).toBe('8px')
    expect(declarationOf('.toolbar', 'padding-bottom')).toBe('8px')
    expect(declarationOf('.toolbar', 'border-bottom')).toBe(
      '0.5px solid var(--dsw-alias-border-l2)',
    )
  })

  it('separates adjacent document rows with one neutral hairline', () => {
    expect(declarationOf('.list > .row + .row', 'border-top')).toBe(
      '0.5px solid var(--dsw-alias-border-l2)',
    )
    // A hairline boundary only reads as a boundary when the rows sit flush.
    expect(declarationOf('.list', 'gap')).toBe('0')
  })

  it('keeps the three row actions on the metadata line at every width', () => {
    expect(declarationOf('.actions', 'white-space')).toBe('nowrap')
    expect(declarationOf('.actions', 'flex-shrink')).toBe('0')
    // No width-swap rule: the old narrow container query turned the action
    // cluster into a full-width second line.
    for (const rule of RULES as Rule[]) {
      const declarations = declarationsOf(rule.body) as { property: string; value: string }[]
      if (rule.selector.includes('.actions')) {
        expect(
          declarations.some(({ property, value }) => property === 'width' && value === '100%'),
        ).toBe(false)
      }
      if (rule.selector.includes('.rowMeta')) {
        expect(
          declarations.some(
            ({ property, value }) => property === 'flex-wrap' && value.includes('wrap'),
          ),
        ).toBe(false)
      }
    }
  })
})
