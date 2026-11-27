import { z } from 'zod'
import type { EvidencePassage } from '../../../sources/model.ts'

export const CLAIM_RELATIONS = ['supports', 'refutes', 'limits', 'uncertain', 'result'] as const
export const EVIDENCE_REVIEWS = ['unreviewed', 'verified', 'disputed'] as const
const MAX_CLAIMS = 32
const MAX_LINKS = 24
const STORAGE_LIMIT = 256 * 1024
const claimLink = z.object({
  sourceItem: z.string().max(2048),
  sourceRef: z.string().max(2048),
  attachmentRef: z.string().max(2048).optional(),
  fingerprint: z.string().max(128).optional(),
  passage: z.string().max(500),
  callId: z.string().max(250).optional(),
  pageIndex: z.number().int().nonnegative().optional(),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
  relation: z.enum(CLAIM_RELATIONS),
  review: z.enum(EVIDENCE_REVIEWS),
})
const claimsSchema = z
  .array(
    z.object({
      id: z.uuid(),
      text: z.string().min(1).max(500),
      evidence: z.array(claimLink).max(MAX_LINKS),
    }),
  )
  .max(MAX_CLAIMS)

export type Claim = z.infer<typeof claimsSchema>[number]
export type ClaimEvidenceLink = z.infer<typeof claimLink>

function key(sessionId: string) {
  return `dsh-zotero:claims:v1:${sessionId}`
}

export function readClaims(sessionId: string): readonly Claim[] {
  try {
    const raw = sessionStorage.getItem(key(sessionId))
    if (raw && raw.length <= STORAGE_LIMIT) {
      const parsed = claimsSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
    }
  } catch {
    // Storage access is optional for an open session.
  }
  return []
}

export function writeClaims(sessionId: string, claims: readonly Claim[]) {
  try {
    const raw = JSON.stringify(claims)
    if (raw.length > STORAGE_LIMIT) return false
    sessionStorage.setItem(key(sessionId), raw)
    return true
  } catch {
    return false
  }
}

export function claimLinkOf(
  sourceItem: string,
  passage: EvidencePassage,
  relation: ClaimEvidenceLink['relation'],
  review: ClaimEvidenceLink['review'],
): ClaimEvidenceLink {
  return {
    sourceItem,
    sourceRef: passage.sourceRef,
    attachmentRef: passage.attachmentRef,
    fingerprint: passage.artifact?.fingerprint,
    passage: passage.text.slice(0, 500).replace(/[\uD800-\uDBFF]$/u, ''),
    callId: passage.callIds[0],
    pageIndex: passage.position?.pageIndex,
    start: passage.start,
    end: passage.end,
    relation,
    review,
  }
}

export function claimPassageKey(link: ClaimEvidenceLink) {
  return JSON.stringify([
    link.sourceItem,
    link.sourceRef,
    link.attachmentRef,
    link.fingerprint,
    link.callId,
    link.start,
    link.end,
    link.pageIndex,
    link.passage,
  ])
}

export function linkClaim(
  claims: readonly Claim[],
  claimId: string,
  text: string,
  evidence: ClaimEvidenceLink,
) {
  if (!claimLink.safeParse(evidence).success) return
  const claim = claims.find((item) => item.id === claimId)
  if (claim) {
    const key = claimPassageKey(evidence)
    const position = claim.evidence.findIndex((other) => claimPassageKey(other) === key)
    if (position < 0 && claim.evidence.length >= MAX_LINKS) return
    const links =
      position < 0
        ? [...claim.evidence, evidence]
        : claim.evidence.map((other, index) => (index === position ? evidence : other))
    return claims.map((item) => (item === claim ? { ...claim, evidence: links } : item))
  }
  const statement = text.trim()
  if (claimId || !statement || claims.length >= MAX_CLAIMS) return
  const next = { id: crypto.randomUUID(), text: statement, evidence: [evidence] }
  if (claimsSchema.safeParse([next]).success) return [...claims, next]
}
