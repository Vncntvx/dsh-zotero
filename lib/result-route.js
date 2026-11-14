import { isFileAttachmentRef } from './result-delivery.js';
import { announcedReceipt, attachmentIdOf } from './result-receipt.js';
import { asRecord, parseNonNegativeSafeInteger } from './json.js';
export async function readResult(ctx, delivery, request) {
    const query = new URL(request.url).searchParams;
    const rawId = query.get('sessionId')?.trim();
    const seq = parseNonNegativeSafeInteger(query.get('seq'));
    const index = parseNonNegativeSafeInteger(query.get('index'));
    if (!rawId || seq === undefined || index === undefined)
        return new Response('Invalid result coordinates', { status: 400 });
    const sessionId = rawId;
    const sessionSeq = seq;
    try {
        const { target } = await ctx.sessionQuery.readEvent({ sessionId, seq: sessionSeq, before: 0, after: 0 }, request.signal);
        const data = asRecord(target.data);
        const message = asRecord(data?.message);
        const content = message?.content ?? data?.content;
        const blocks = Array.isArray(content) ? content : [];
        const files = blocks.filter((block) => asRecord(block)?.type === 'file');
        const meta = asRecord(data?.meta);
        const attachmentRecord = asRecord(asRecord(files[index])?.attachment);
        let attachment = attachmentRecord;
        // Standard blocks remain readable after replay/fork without a running job registry.
        const announcedId = attachmentIdOf(attachmentRecord);
        if (announcedReceipt(blocks, announcedId) === undefined)
            attachment = undefined;
        // An original background acknowledgement is also a durable owning-call coordinate.
        if (!attachment &&
            index === 0 &&
            target.type === 'tool/result' &&
            typeof meta?.resultSessionId === 'string' &&
            typeof message?.toolCallId === 'string' &&
            ['background', 'promoted'].includes(String(meta.kind))) {
            const receipt = await delivery.receipt(meta.resultSessionId, message.toolCallId);
            if (receipt && receipt.jobId === meta.jobId)
                attachment = receipt.file;
        }
        if (!isFileAttachmentRef(attachment) ||
            !['tool/result', 'tool/ptc-dispatch', 'user/message'].includes(target.type))
            return new Response('Result file not found', { status: 404 });
        const source = ctx.attachments
            .readFileStream(attachment, request.signal)[Symbol.asyncIterator]();
        const stream = new ReadableStream({
            async pull(controller) {
                try {
                    const chunk = await source.next();
                    if (chunk.done)
                        controller.close();
                    else
                        controller.enqueue(chunk.value);
                }
                catch (error) {
                    controller.error(error);
                }
            },
            async cancel() {
                await source.return?.();
            },
        });
        return new Response(stream, {
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        });
    }
    catch {
        request.signal.throwIfAborted();
        return new Response('Result unavailable', { status: 404 });
    }
}
export function registerResultRoute(ctx, delivery) {
    ctx.inject(['connection', 'sessionQuery', 'attachments'], (host) => {
        host.effect(() => host.connection.fetch.register({
            path: '/api/zotero/result',
            methods: ['GET'],
            requestBody: 'buffered',
            fetch: (request) => readResult(host, delivery, request),
        }), 'zotero: result route');
    });
}
//# sourceMappingURL=result-route.js.map