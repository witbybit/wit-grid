/** The Wit Grid "W": the lit cells of a 5×3 grid, in the order a stroke would draw the letter. */
const W_PATH: [col: number, row: number][] = [
	[0, 0],
	[0, 1],
	[1, 2],
	[2, 1],
	[3, 2],
	[4, 1],
	[4, 0],
];
const COLUMN_COLOURS = ['#38bdf8', '#38bdf8', '#6d7cff', '#6d7cff', '#a855f7'];
const DIM_COLOUR = '#6d7cff';

export interface MarkCell {
	x: number;
	y: number;
	/** Position along the W, or -1 for an unlit cell. */
	step: number;
	fill: string;
}

/** Every cell of the mark on a 64-unit square: 10-unit cells on a 12-unit pitch. */
export const MARK_CELLS: MarkCell[] = Array.from({ length: 15 }, (_, i) => {
	const col = Math.floor(i / 3);
	const row = i % 3;
	const step = W_PATH.findIndex(([c, r]) => c === col && r === row);
	return { x: 3 + col * 12, y: 15 + row * 12, step, fill: step < 0 ? DIM_COLOUR : COLUMN_COLOURS[col] };
});

function MarkCells() {
	return MARK_CELLS.map((cell) => (
		<rect
			key={`${cell.x}-${cell.y}`}
			className={cell.step < 0 ? 'wg-mark-dim' : 'wg-mark-lit'}
			x={cell.x}
			y={cell.y}
			width='10'
			height='10'
			rx='2.2'
			fill={cell.fill}
			opacity={cell.step < 0 ? 0.18 : undefined}
			style={cell.step < 0 ? undefined : { animationDelay: `${0.25 + cell.step * 0.09}s`, transformOrigin: `${cell.x + 5}px ${cell.y + 5}px` }}
		/>
	));
}

/** The wordmark: the mark stands in for the w, then "it grid", with the i dotted by a selected cell. */
export function WitGridWordmark({ animated = false, className }: { animated?: boolean; className?: string }) {
	return (
		<span className={['wg-word', animated && 'wg-mark-animated', className].filter(Boolean).join(' ')} aria-label='Wit Grid' role='img'>
			<svg className='wg-word-w' viewBox='3 15 58 34' fill='none' xmlns='http://www.w3.org/2000/svg' aria-hidden>
				<MarkCells />
			</svg>
			<span aria-hidden>
				<span className='wg-word-i'>ı</span>t grid
			</span>
		</span>
	);
}
