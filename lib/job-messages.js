/** Pure background receipt text shared by producers and presentation fixtures. */
export function jobStartedMessage(jobId) {
    return `started background job ${jobId}`;
}
export function jobPromotedMessage(jobId, timeoutMs) {
    return `operation timed out after ${timeoutMs}ms and was promoted to background job ${jobId}`;
}
//# sourceMappingURL=job-messages.js.map