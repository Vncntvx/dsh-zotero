/** Static shell text inspection; no command, expansion or substitution is executed. */
export function literalShellSegments(text) {
    const source = text.replace(/\\\r?\n/g, ' ');
    const segments = [];
    let quote;
    let ansiQuote = false;
    let current = '';
    let pipeline = [];
    const flushCommand = () => {
        if (current.trim() !== '') {
            segments.push(current);
            pipeline.push(current);
        }
        current = '';
    };
    const flushPipeline = () => {
        if (pipeline.length > 1 && pipeline.some((part) => /\b(?:nc|netcat|ncat|socat)\b/.test(part)))
            segments.push(pipeline.join(' | '));
        pipeline = [];
    };
    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        if (char === '\\' && (quote !== "'" || ansiQuote)) {
            current += char;
            if (index + 1 < source.length)
                current += source[++index];
            continue;
        }
        if (quote !== undefined) {
            current += char;
            if (char === quote) {
                // PowerShell's doubled quote is a literal quote in the current string.
                if (source[index + 1] === quote && quote !== '`')
                    current += source[++index];
                else
                    quote = undefined;
            }
            continue;
        }
        if (char === "'" || char === '"' || char === '`') {
            quote = char;
            ansiQuote = char === "'" && source[index - 1] === '$';
            current += char;
            continue;
        }
        if (';&|\n\r'.includes(char)) {
            flushCommand();
            if (char !== '|' || source[index + 1] === '|')
                flushPipeline();
            if (source[index + 1] === char && (char === '|' || char === '&'))
                index++;
            continue;
        }
        current += char;
    }
    flushCommand();
    flushPipeline();
    const variables = new Map();
    return segments.map((segment) => {
        let remaining = segment.trimStart().replace(/^export\s+/, '');
        for (;;) {
            const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(?:'([^']*)'|"([^"$`]*)"|([^\s'"$`]+))(?:\s+|$)/.exec(remaining);
            if (assignment === null)
                break;
            variables.set(assignment[1], assignment[2] ?? assignment[3] ?? assignment[4]);
            remaining = remaining.slice(assignment[0].length);
        }
        return segment.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (spelling, braced, plain) => variables.get(braced ?? plain) ?? spelling);
    });
}
function localHost(host) {
    return (host === 'localhost' ||
        host.endsWith('.localhost') ||
        host === '[::1]' ||
        host === '[::]' ||
        host === '0.0.0.0' ||
        /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host) ||
        /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host) ||
        host === '[::ffff:0:0]');
}
/** WHATWG canonicalization covers short, octal, hexadecimal and integer IPv4 spellings. */
export function localAddressesIn(text) {
    const found = [];
    const candidates = /https?:\/\/[^\s'"`<>\\]+|(?:\[[\da-fA-F:.]+\]|localhost(?:\.[\w.-]+)?|[\da-fA-Fx.]+)(?::\d+)?/gi;
    for (const match of text.matchAll(candidates)) {
        try {
            const url = new URL(/^https?:/i.test(match[0]) ? match[0] : `http://${match[0]}`);
            if (localHost(url.hostname.toLowerCase()))
                found.push(url);
        }
        catch {
            /* A shell token need not be an address. */
        }
    }
    return found;
}
//# sourceMappingURL=shell-command-scan.js.map