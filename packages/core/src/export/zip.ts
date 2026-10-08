/**
 * A small ZIP writer for exports (an .xlsx is a ZIP of XML parts). Entries are deflated with the
 * platform's CompressionStream where there is one, else stored.
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
	const Stream = (globalThis as { CompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array> }).CompressionStream;
	if (!Stream) return null;
	try {
		const compressed = new Blob([data as BlobPart]).stream().pipeThrough(new Stream('deflate-raw'));
		return new Uint8Array(await new Response(compressed).arrayBuffer());
	} catch {
		return null;
	}
}

export interface ZipEntry {
	name: string;
	data: string | Uint8Array;
}

/** The ZIP archive of the entries. */
export async function createZip(entries: readonly ZipEntry[]): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;
	// DOS date/time of 1980-01-01 00:00 (the archive's timestamps carry no meaning).
	const dosTime = 0;
	const dosDate = (0 << 9) | (1 << 5) | 1;

	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
		const crc = crc32(raw);
		const deflated = await deflateRaw(raw);
		const useDeflate = !!deflated && deflated.length < raw.length;
		const body = useDeflate ? deflated! : raw;
		const method = useDeflate ? 8 : 0;

		const local = new Uint8Array(30 + name.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(6, 0x0800, true); // UTF-8 names
		lv.setUint16(8, method, true);
		lv.setUint16(10, dosTime, true);
		lv.setUint16(12, dosDate, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, body.length, true);
		lv.setUint32(22, raw.length, true);
		lv.setUint16(26, name.length, true);
		local.set(name, 30);

		const central = new Uint8Array(46 + name.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, 20, true);
		cv.setUint16(6, 20, true);
		cv.setUint16(8, 0x0800, true);
		cv.setUint16(10, method, true);
		cv.setUint16(12, dosTime, true);
		cv.setUint16(14, dosDate, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, body.length, true);
		cv.setUint32(24, raw.length, true);
		cv.setUint16(28, name.length, true);
		cv.setUint32(42, offset, true);
		central.set(name, 46);

		locals.push(local, body);
		centrals.push(central);
		offset += local.length + body.length;
	}

	const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);

	const out = new Uint8Array(offset + centralSize + end.length);
	let at = 0;
	for (const part of [...locals, ...centrals, end]) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
