/** Canonical model-facing message when an attachment file is missing from disk. */
export function missingAttachmentFileMessage(path: string): string {
  return `The attachment file is missing from disk: ${path}`
}
