/**
 * The Wit Grid mark: a grid tile with a header row and one selected cell (with a spreadsheet
 * fill handle). `animated` draws the lines in and lets the selected cell glow.
 */
export function WitGridMark({
	size = 32,
	animated = false,
	className,
	id = 'wgm',
}: {
	size?: number;
	animated?: boolean;
	className?: string;
	/** Prefix for the SVG gradient ids: give each mark on a page its own. */
	id?: string;
}) {
	const stroke = `url(#${id}-stroke)`;
	return (
		<svg
			width={size}
			height={size}
			viewBox='0 0 64 64'
			fill='none'
			xmlns='http://www.w3.org/2000/svg'
			className={[animated ? 'wg-mark wg-mark-animated' : 'wg-mark', className].filter(Boolean).join(' ')}
			aria-hidden
		>
			<defs>
				<linearGradient id={`${id}-stroke`} x1='4' y1='4' x2='60' y2='60' gradientUnits='userSpaceOnUse'>
					<stop stopColor='#38bdf8' />
					<stop offset='0.55' stopColor='#6d7cff' />
					<stop offset='1' stopColor='#a855f7' />
				</linearGradient>
				<linearGradient id={`${id}-cell`} x1='26' y1='26' x2='44' y2='44' gradientUnits='userSpaceOnUse'>
					<stop stopColor='#38bdf8' />
					<stop offset='1' stopColor='#8b5cf6' />
				</linearGradient>
			</defs>
			{/* Header row */}
			<path d='M8 6h48a4 4 0 0 1 4 4v12H4V10a4 4 0 0 1 4-4Z' fill={stroke} opacity='0.16' />
			{/* Selected cell */}
			<rect className='wg-mark-cell' x='25' y='25' width='16' height='16' rx='2.5' fill={`url(#${id}-cell)`} />
			{/* Frame and grid lines */}
			<rect className='wg-mark-line' x='4' y='6' width='56' height='52' rx='7' stroke={stroke} strokeWidth='3' pathLength='100' />
			<path className='wg-mark-line wg-mark-line-2' d='M4 22h56' stroke={stroke} strokeWidth='3' pathLength='100' />
			<path className='wg-mark-line wg-mark-line-3' d='M4 40h56' stroke={stroke} strokeWidth='2' strokeOpacity='0.65' pathLength='100' />
			<path className='wg-mark-line wg-mark-line-4' d='M23 22v36M43 22v36' stroke={stroke} strokeWidth='2' strokeOpacity='0.65' pathLength='100' />
			{/* Fill handle */}
			<rect className='wg-mark-handle' x='38.5' y='38.5' width='5' height='5' rx='1' fill='#fff' stroke='#6d7cff' strokeWidth='1.5' />
		</svg>
	);
}
