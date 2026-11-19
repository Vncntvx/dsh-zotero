/** Literal user values in approval documents never introduce plan syntax. */
export function planValue(value) {
    return String(value)
        .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, (character) => {
        if (character === '\n')
            return '\\n';
        if (character === '\r')
            return '\\r';
        if (character === '\t')
            return '\\t';
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
    })
        .replace(/([\\`*_{}\[\]()<>#+!|~&])/g, '\\$1');
}
/** A complete literal payload; authored backticks cannot terminate its fence. */
export function planBlock(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const runs = text.match(/`+/g) ?? [];
    const fence = '`'.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3));
    return `${fence}${typeof value === 'string' ? '' : 'json'}\n${text}\n${fence}`;
}
export const WRITE_AUTHORIZATION_PLAN_LINE = 'Zotero may ask for a single-use or persistent authorization. Independent objects share native batches of at most 50; dependent children settle before parents. Each request spends one single-use grant. Prompts share a five-per-minute budget and may wait for capacity; cancelling stops further requests. The approved operation has a 15-minute deadline. Completed or unverified writes are never retried.';
//# sourceMappingURL=write-plan.js.map