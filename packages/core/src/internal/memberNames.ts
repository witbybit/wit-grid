/**
 * Whitespace-separated member names kept as one literal type, so a long list of
 * names costs a few lines and the compiler still checks it against a surface type.
 */
type Normalize<S extends string> = S extends `${infer A}\n${infer B}`
	? Normalize<`${A} ${B}`>
	: S extends `${infer A}\t${infer B}`
		? Normalize<`${A}${B}`>
		: S;
type SplitNames<S extends string, Acc extends string = never> = S extends `${infer Head} ${infer Rest}` ? SplitNames<Rest, Acc | Head> : Acc | S;

export type MemberNames<S extends string> = Exclude<SplitNames<Normalize<S>>, ''>;

export function memberNames<const S extends string>(list: S): readonly MemberNames<S>[] {
	return list.split(/\s+/).filter(Boolean) as MemberNames<S>[];
}

/** A new object holding only `keys` of `source`, with their values read once. */
export function pickMembers<T extends object, const K extends readonly (keyof T)[]>(source: T, keys: K): Pick<T, K[number]> {
	const picked = {} as Pick<T, K[number]>;
	for (const key of keys) picked[key as K[number]] = source[key as K[number]];
	return picked;
}
