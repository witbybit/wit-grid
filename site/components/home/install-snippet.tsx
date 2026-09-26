'use client';

import { useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';

const COMMAND = 'pnpm add @eregister/wit-grid-react';

export function InstallSnippet() {
	const [copied, setCopied] = useState(false);

	async function copy() {
		await navigator.clipboard.writeText(COMMAND);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1400);
	}

	return (
		<button
			type='button'
			onClick={copy}
			className='wg-install-snippet group inline-flex items-center gap-3 rounded-lg border border-fd-border bg-fd-card/80 px-4 py-2 font-mono text-sm text-fd-foreground transition-colors hover:border-sky-500/50'
		>
			<Terminal aria-hidden size={14} className='text-fd-muted-foreground' />
			<span>{COMMAND}</span>
			{copied ? (
				<Check aria-hidden size={14} className='text-emerald-500' />
			) : (
				<Copy aria-hidden size={14} className='text-fd-muted-foreground transition-colors group-hover:text-sky-500' />
			)}
		</button>
	);
}
