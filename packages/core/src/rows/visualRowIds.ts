export type GroupPathItem = {
	field: string;
	key: unknown;
	keyString: string;
};

function encodeIdPart(value: string): string {
	let needsEncoding = false;
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		const isSafe =
			(code >= 48 && code <= 57) ||
			(code >= 65 && code <= 90) ||
			(code >= 97 && code <= 122) ||
			code === 45 ||
			code === 46 ||
			code === 95 ||
			code === 126;
		if (!isSafe) {
			needsEncoding = true;
			break;
		}
	}
	if (!needsEncoding) return value;
	return encodeURIComponent(value);
}

export function toDataVisualRowId(rowId: string): string {
	return `row:${encodeIdPart(rowId)}`;
}

export function toDetailVisualRowId(rowId: string): string {
	return `detail:${encodeIdPart(rowId)}`;
}

export function toGroupVisualRowId(path: GroupPathItem[] | string): string {
	if (typeof path === 'string') {
		return path.startsWith('group:') ? path : `group:${encodeIdPart(path)}`;
	}
	const stablePath = path.map((item) => `${encodeIdPart(item.field)}=${encodeIdPart(item.keyString)}`).join('/');
	return `group:${stablePath}`;
}

export function toTotalVisualRowId(groupId: string | null): string {
	return groupId === null ? 'total:grand' : `total:${encodeIdPart(groupId)}`;
}

export function toLoadingVisualRowId(index: number): string {
	return `loading:${index}`;
}

export function toFailedVisualRowId(index: number): string {
	return `failed:${index}`;
}

export function toPlaceholderVisualRowId(index: number): string {
	return `placeholder:${index}`;
}

export function parseVisualRowId(id: string): { kind: string; key: string } | null {
	const separator = id.indexOf(':');
	if (separator < 0) return null;
	return {
		kind: id.slice(0, separator),
		key: decodeURIComponent(id.slice(separator + 1)),
	};
}
