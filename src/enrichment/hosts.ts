/**
 * The one declaration of the MinerU API host.
 *
 * Only the fixed API base (`mineru.net`) belongs here. Result CDN links and
 * signed upload URLs are returned dynamically by the API and may live on any
 * public host; those go through the public-address double gate instead of a
 * static allowlist. Keeping that boundary explicit is what stops a token from
 * ever being attached to a third-party CDN (see `transport.ts`).
 * @module dsh-zotero/enrichment/hosts
 */

/** The fixed MinerU API host. */
export const MINERU_API_HOST = 'mineru.net'

/** Base origin for every submit/poll call. */
export const MINERU_API_ORIGIN = `https://${MINERU_API_HOST}`

/** Whether a URL's hostname is the MinerU API host (exact, no subdomains). */
export function isMineruApiHost(hostname: string): boolean {
  return hostname.toLowerCase() === MINERU_API_HOST
}

/** Submit + poll endpoints, per mode. */
export const MINERU_ENDPOINTS = {
  free: {
    /** JSON POST: `{ file_name, ... }` → `{ data: { task_id, file_url } }`. */
    submit: `${MINERU_API_ORIGIN}/api/v1/agent/parse/file`,
    /** GET by task_id → `{ data: { state, markdown_url } }`. */
    poll: (taskId: string): string =>
      `${MINERU_API_ORIGIN}/api/v1/agent/parse/${encodeURIComponent(taskId)}`,
  },
  pro: {
    /** JSON POST: `{ files: [{ name }], model_version }` → `{ data: { batch_id, file_urls } }`. */
    submit: `${MINERU_API_ORIGIN}/api/v4/file-urls/batch`,
    /** GET by batch_id → `{ data: { extract_result: [{ state, full_zip_url }] } }`. */
    poll: (batchId: string): string =>
      `${MINERU_API_ORIGIN}/api/v4/extract-results/batch/${encodeURIComponent(batchId)}`,
  },
} as const

/** The precise model version used for the higher-quality output. */
export const PRO_MODEL_VERSION = 'vlm'
