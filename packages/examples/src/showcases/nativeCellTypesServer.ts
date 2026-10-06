/**
 * A pretend server for the native cell types demo: 10,000 accounts and a 2,000-person directory,
 * searched and paged with network-like latency. The async columns load from it page by page.
 */
import type { CellOption, CellOptionsPage, CellOptionsQuery, PersonOption } from '@eregister/wit-grid-react';

const NAME_A = [
	'Northwind',
	'Contoso',
	'Fabrikam',
	'Globex',
	'Initech',
	'Umbrella',
	'Stark',
	'Wayne',
	'Acme',
	'Hooli',
	'Vandelay',
	'Soylent',
	'Tyrell',
	'Cyberdyne',
	'Wonka',
	'Oscorp',
];
const NAME_B = ['Labs', 'Systems', 'Logistics', 'Health', 'Capital', 'Foods', 'Energy', 'Media', 'Robotics', 'Retail', 'Analytics', 'Aerospace'];
const REGIONS = ['EMEA', 'Americas', 'APAC'];
const PLANS: { label: string; color: CellOption['color'] }[] = [
	{ label: 'Enterprise', color: 'violet' },
	{ label: 'Business', color: 'blue' },
	{ label: 'Starter', color: 'teal' },
];

export const ACCOUNTS: CellOption[] = Array.from({ length: 10_000 }, (_, i) => {
	const plan = PLANS[i % PLANS.length];
	return {
		value: `acc-${i + 1}`,
		label: `${NAME_A[i % NAME_A.length]} ${NAME_B[Math.floor(i / NAME_A.length) % NAME_B.length]} ${Math.floor(i / (NAME_A.length * NAME_B.length)) + 1}`,
		description: `${REGIONS[i % REGIONS.length]} · ${plan.label} · #${i + 1}`,
		color: plan.color,
	};
});

const FIRST = [
	'Ava',
	'Liam',
	'Noah',
	'Mia',
	'Zoe',
	'Ethan',
	'Sofia',
	'Kai',
	'Iris',
	'Omar',
	'Lena',
	'Ravi',
	'Nora',
	'Theo',
	'Yuki',
	'Ines',
	'Arjun',
	'Maya',
	'Felix',
	'Hana',
];
const LAST = [
	'Chen',
	'Novak',
	'Patel',
	'Rossi',
	'Okafor',
	'Brooks',
	'Lind',
	'Tanaka',
	'Garcia',
	'Haddad',
	'Kowalski',
	'Mensah',
	'Silva',
	'Berg',
	'Ito',
	'Moreau',
	'Shah',
	'Kim',
	'Weber',
	'Costa',
];
const ROLES = ['Engineering', 'Design', 'Product', 'Sales', 'Support', 'Finance'];

export const DIRECTORY: PersonOption[] = Array.from({ length: 2_000 }, (_, i) => {
	const first = FIRST[i % FIRST.length];
	const last = LAST[Math.floor(i / FIRST.length) % LAST.length];
	const suffix = i >= FIRST.length * LAST.length ? ` ${Math.floor(i / (FIRST.length * LAST.length)) + 1}` : '';
	return {
		value: `u${i + 1}`,
		label: `${first} ${last}${suffix}`,
		description: `${ROLES[i % ROLES.length]} · ${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
	};
});

/** Resolves after a network-like delay, or rejects as soon as the request is aborted. */
function latency(signal?: AbortSignal, ms = 220 + Math.random() * 280): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			reject(new DOMException('Aborted', 'AbortError'));
		});
	});
}

function pagedSearch<T extends CellOption>(all: readonly T[]) {
	const byValue = new Map(all.map((option) => [option.value, option]));
	return {
		/** One page of matches for a search: how a `loadOptions` endpoint would answer. */
		async load({ search, offset, limit, signal }: CellOptionsQuery): Promise<CellOptionsPage> {
			await latency(signal);
			const q = search.trim().toLowerCase();
			const hits = q ? all.filter((option) => option.label!.toLowerCase().includes(q) || !!option.description?.toLowerCase().includes(q)) : all;
			return { options: hits.slice(offset, offset + limit), hasMore: offset + limit < hits.length, total: hits.length };
		},
		/** The options for values shown in cells: how a `resolveOptions` endpoint would answer. */
		async resolve(values: string[]): Promise<CellOption[]> {
			await latency(undefined, 350);
			return values.map((value) => byValue.get(value)).filter((option): option is T => !!option);
		},
	};
}

export const accountsServer = pagedSearch(ACCOUNTS);
export const directoryServer = pagedSearch(DIRECTORY);
