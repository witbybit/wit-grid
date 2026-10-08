/**
 * The Wit Grid mark for generated icons (favicon, Apple touch icon): solid colours, since the
 * image renderer draws gradients unevenly at small sizes.
 */
export function MarkIcon({ size }: { size: number }) {
	return (
		<svg width={size} height={size} viewBox='0 0 64 64' fill='none' xmlns='http://www.w3.org/2000/svg'>
			<path d='M8 6h48a4 4 0 0 1 4 4v12H4V10a4 4 0 0 1 4-4Z' fill='#6d7cff' opacity='0.28' />
			<rect x='25' y='25' width='16' height='16' rx='2.5' fill='#6d7cff' />
			<rect x='4' y='6' width='56' height='52' rx='7' stroke='#8b9bff' strokeWidth='4' />
			<path d='M4 22h56' stroke='#8b9bff' strokeWidth='4' />
			<path d='M4 40h56M23 22v36M43 22v36' stroke='#8b9bff' strokeWidth='3' strokeOpacity='0.7' />
			<rect x='38.5' y='38.5' width='5' height='5' rx='1' fill='#ffffff' />
		</svg>
	);
}
