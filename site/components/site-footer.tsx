export function SiteFooter() {
	return (
		<footer className='border-t border-fd-border px-6 py-6 text-center text-xs text-fd-muted-foreground'>
			© {new Date().getFullYear()} Wit By Bit. Wit Grid is proprietary, source-available software for evaluation — not open source. See the{' '}
			<a href='https://github.com/witbybit/open-grid/blob/main/LICENSE' className='underline underline-offset-2 hover:text-fd-foreground'>
				license
			</a>{' '}
			for full terms.
		</footer>
	);
}
