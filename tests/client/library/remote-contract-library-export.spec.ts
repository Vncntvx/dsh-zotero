/**
 * The library panel's `export` wire endpoint under the parity runner: request
 * and result arms, including the three result formats. Split from
 * `remote-contract-library.spec.ts` so the panel's export contract keeps its
 * own spec under the size budget.
 * @module tests/client/library/remote-contract-library-export
 */

import {
  ZOTERO_LIBRARY_EXPORT_REQUEST_TYPE_SYMBOL,
  ZOTERO_LIBRARY_EXPORT_RESULT_TYPE_SYMBOL,
} from '../../../src/contract.ts'
import { runRemoteParitySpec, type ParityCase } from '../helpers/remote-parity.ts'

const PARITY_CASES: readonly ParityCase[] = [
  {
    method: 'export',
    boundary: { kind: 'param', index: 0 },
    wire: 'library export request',
    typeSymbol: ZOTERO_LIBRARY_EXPORT_REQUEST_TYPE_SYMBOL,
    valid: { refs: ['zotero://user/0/item/ITEMKEY1'], format: 'bibtex' },
    incomplete: [{ format: 'bibtex' }, { refs: ['r'] }],
    malformed: [
      // The refs list is bounded on both ends: at least one ref, at most
      // Zotero's itemKey request cap (50).
      { refs: [], format: 'bibtex' },
      { refs: [''], format: 'bibtex' },
      { refs: ['r'], format: 'bibtex', style: '' },
      { refs: ['r'], format: 'bibtex', locale: '' },
      { refs: 'r', format: 'bibtex' },
      { refs: Array.from({ length: 51 }, () => 'r'), format: 'citation' },
    ],
    undeclared: [{ refs: ['r'], format: 'bibtex', sessionId: 'session-1' }],
    badEnum: [
      { refs: ['r'], format: 'markdown' },
      { refs: ['r'], format: 'BibTeX' },
    ],
  },
  {
    method: 'export',
    boundary: { kind: 'result' },
    wire: 'library export citation result',
    typeSymbol: ZOTERO_LIBRARY_EXPORT_RESULT_TYPE_SYMBOL,
    valid: { format: 'citation', citations: [{ ref: 'r', text: '(Doe, 2020)' }] },
    incomplete: [{ citations: [] }, { format: 'citation' }],
    malformed: [
      { format: 'citation', citations: 'r' },
      { format: 'citation', citations: [{ ref: 'r' }] },
      { format: 'citation', citations: [{ ref: 1, text: 't' }] },
    ],
    undeclared: [{ format: 'citation', citations: [], text: 'x' }],
    badEnum: [{ format: 'endnote', citations: [] }],
  },
  {
    method: 'export',
    boundary: { kind: 'result' },
    wire: 'library export bibliography result',
    typeSymbol: ZOTERO_LIBRARY_EXPORT_RESULT_TYPE_SYMBOL,
    valid: { format: 'bibliography', style: 'apa', locale: 'en-US', text: '[1] Doe.' },
    incomplete: [{ format: 'bibliography' }, { text: 'x' }],
    malformed: [{ format: 'bibliography', text: 1 }],
    undeclared: [{ format: 'bibliography', text: 'x', items: [] }],
    badEnum: [{ format: 'endnote', text: 'x' }],
  },
  {
    method: 'export',
    boundary: { kind: 'result' },
    wire: 'library export translator result',
    typeSymbol: ZOTERO_LIBRARY_EXPORT_RESULT_TYPE_SYMBOL,
    valid: { format: 'bibtex', text: '@article{doe2020}' },
    incomplete: [{ format: 'bibtex' }, { text: '@article{doe2020}' }],
    malformed: [
      { format: 'bibtex', text: 1 },
      { format: 'biblatex', text: null },
    ],
    // The panel serves rendered text only: an itemization field is not part of
    // the wire contract, so the strict codec must refuse it rather than drop
    // it silently.
    undeclared: [
      { format: 'ris', text: 'x', items: [] },
      { format: 'bibtex', text: 'x', raw: true },
    ],
    badEnum: [{ format: 'endnote', text: 'r' }],
  },
]

runRemoteParitySpec(PARITY_CASES)
