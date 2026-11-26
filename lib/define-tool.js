/** Closed parameter names for plugin tools; the host validates every declared value. */
import { defineTool, ToolArgsError, validateJsonSchemaValue, } from '@deepseek-ai/dsh-tools';
import { asRecord } from './json.js';
export function defineZoteroTool(options) {
    const tool = defineTool(options);
    const declared = new Set(Object.keys(options.parameters));
    const parameters = { ...tool.parameters, type: 'object', additionalProperties: false };
    return {
        ...tool,
        parameters,
        execute(args, exec) {
            const record = asRecord(args);
            if (record !== undefined) {
                const unknown = Object.keys(record).filter((key) => !declared.has(key));
                if (unknown.length > 0)
                    throw new ToolArgsError(validateJsonSchemaValue(parameters, args, ''));
            }
            return tool.execute(args, exec);
        },
    };
}
//# sourceMappingURL=define-tool.js.map