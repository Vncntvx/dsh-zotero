/** Pure background receipt text shared by producers and presentation fixtures. */
export function jobStartedMessage(jobId: string): string {
  return `started background job ${jobId}`
}

export function jobPromotedMessage(jobId: string, timeoutMs: number): string {
  return `operation timed out after ${timeoutMs}ms and was promoted to background job ${jobId}`
}
