/** ZIP directory proof and bounded native inflation; no declared-length allocation. */
import { crc32, inflateRawSync } from 'node:zlib';
import { ZIP_MAX_TOTAL_ENTRIES } from './archive-limits.js';
function refuse(reason) {
    throw new Error(`unsafe ZIP: ${reason}`);
}
/** Prove the central directory, local headers, data descriptors and byte ranges agree. */
export function readZipDirectory(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (at) => view.getUint16(at, true);
    const u32 = (at) => view.getUint32(at, true);
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65_557); end--) {
        if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length)
            break;
    }
    if (end < 0 || end < bytes.length - 65_557)
        refuse('end record is missing');
    const count = u16(end + 10);
    const directorySize = u32(end + 12);
    const directory = u32(end + 16);
    if (u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== count)
        refuse('split archives are unsupported');
    if (count === 0xffff || directorySize === 0xffffffff || directory === 0xffffffff)
        refuse('ZIP64 archives are unsupported');
    if (count > ZIP_MAX_TOTAL_ENTRIES)
        refuse('excessive entry count');
    if (directory + directorySize !== end)
        refuse('directory bounds do not match');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const entries = [];
    const names = new Set();
    const ranges = [];
    let cursor = directory;
    for (let index = 0; index < count; index++) {
        if (cursor + 46 > end || u32(cursor) !== 0x02014b50)
            refuse('invalid directory entry');
        const flags = u16(cursor + 8);
        const compression = u16(cursor + 10);
        const checksum = u32(cursor + 16);
        const compressedSize = u32(cursor + 20);
        const size = u32(cursor + 24);
        const nameSize = u16(cursor + 28);
        const next = cursor + 46 + nameSize + u16(cursor + 30) + u16(cursor + 32);
        const local = u32(cursor + 42);
        if (next > end || nameSize === 0 || u16(cursor + 34) !== 0)
            refuse('invalid entry bounds');
        if ((flags & ~0x080e) !== 0 || (compression !== 0 && compression !== 8))
            refuse('encrypted or unsupported entry');
        if (size === 0xffffffff || compressedSize === 0xffffffff || local === 0xffffffff)
            refuse('ZIP64 entry is unsupported');
        const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameSize);
        const name = decoder.decode(nameBytes);
        if (names.has(name))
            refuse('duplicate entry name');
        names.add(name);
        if (local + 30 > directory || u32(local) !== 0x04034b50)
            refuse('invalid local header');
        if (u16(local + 6) !== flags || u16(local + 8) !== compression || u16(local + 26) !== nameSize)
            refuse('local and central header disagree');
        const offset = local + 30 + nameSize + u16(local + 28);
        if (offset > directory || !nameBytes.every((value, at) => bytes[local + 30 + at] === value))
            refuse('local entry name disagrees');
        let dataEnd = offset + compressedSize;
        if (dataEnd > directory)
            refuse('compressed bytes exceed entry bounds');
        if ((flags & 8) === 0) {
            if (u32(local + 14) !== checksum ||
                u32(local + 18) !== compressedSize ||
                u32(local + 22) !== size)
                refuse('local and central lengths or checksum disagree');
        }
        else {
            const descriptor = dataEnd + (dataEnd + 4 <= directory && u32(dataEnd) === 0x08074b50 ? 4 : 0);
            if (descriptor + 12 > directory ||
                u32(descriptor) !== checksum ||
                u32(descriptor + 4) !== compressedSize ||
                u32(descriptor + 8) !== size)
                refuse('data descriptor disagrees');
            dataEnd = descriptor + 12;
        }
        ranges.push({ start: local, end: dataEnd });
        entries.push({ name, size, compressedSize, compression, checksum, offset });
        cursor = next;
    }
    if (cursor !== end)
        refuse('directory count or size disagrees');
    ranges.sort((a, b) => a.start - b.start);
    for (let index = 1; index < ranges.length; index++) {
        if (ranges[index].start < ranges[index - 1].end)
            refuse('overlapping entry ranges');
    }
    return entries;
}
/** Inflate with an actual output cap, then verify both byte length and CRC. */
export function readZipEntry(bytes, entry, maxBytes) {
    if (entry.size > maxBytes)
        refuse('oversized entry');
    const compressed = bytes.subarray(entry.offset, entry.offset + entry.compressedSize);
    let output = compressed;
    if (entry.compression === 8) {
        // Node returns { buffer, engine } with info:true; validate that public
        // runtime shape because its declarations currently retain the Buffer overload.
        const result = inflateRawSync(compressed, { maxOutputLength: maxBytes, info: true });
        if (result === null ||
            typeof result !== 'object' ||
            !('buffer' in result) ||
            !(result.buffer instanceof Uint8Array) ||
            !('engine' in result) ||
            result.engine === null ||
            typeof result.engine !== 'object' ||
            !('bytesWritten' in result.engine) ||
            result.engine.bytesWritten !== compressed.byteLength)
            refuse('compressed stream does not consume its declared bytes');
        output = result.buffer;
    }
    if (output.byteLength > maxBytes || output.byteLength !== entry.size)
        refuse('actual output does not match declared size');
    if (crc32(output) !== entry.checksum)
        refuse('checksum mismatch');
    return output;
}
//# sourceMappingURL=zip-reader.js.map