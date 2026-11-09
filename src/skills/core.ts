import { evidenceSynthesis } from './evidence-synthesis.js'
import { libraryGovernance } from './library-governance.js'
import { manuscriptReferenceAudit } from './manuscript-reference-audit.js'
import { paperDigest } from './paper-digest.js'

export const CORE_SOPS = [
  paperDigest,
  evidenceSynthesis,
  manuscriptReferenceAudit,
  libraryGovernance,
] as const
