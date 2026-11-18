import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../errors.js'
import type { BundleSnapshot } from '../model-installation.js'

export class SemanticBundleFailure extends ZoteroError {
  readonly kind: 'missing' | 'corrupt'
  readonly snapshot: BundleSnapshot

  constructor(message: string, kind: 'missing' | 'corrupt', snapshot: BundleSnapshot) {
    super(message, ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE)
    this.kind = kind
    this.snapshot = snapshot
  }
}
