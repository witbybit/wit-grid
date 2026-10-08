import { MARK_CELLS } from './wit-grid-mark';

/** The Wit Grid mark for generated icons (favicon, Apple touch icon): the same cells, no classes. */
export function MarkIcon({ size }: { size: number }) {
	return (
		<svg width={size} height={size} viewBox='0 0 64 64' fill='none' xmlns='http://www.w3.org/2000/svg'>
			{MARK_CELLS.map((cell) => (
				<rect
					key={`${cell.x}-${cell.y}`}
					x={cell.x}
					y={cell.y}
					width='10'
					height='10'
					rx='2.2'
					fill={cell.fill}
					opacity={cell.step < 0 ? 0.22 : 1}
				/>
			))}
		</svg>
	);
}
