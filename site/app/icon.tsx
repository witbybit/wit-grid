import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
	return new ImageResponse(
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				background: '#0f172a',
				borderRadius: 6,
			}}
		>
			<svg width='20' height='20' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
				<rect x='2' y='2' width='20' height='20' rx='2' stroke='#e2e8f0' strokeWidth='2' />
				<line x1='2' y1='9' x2='22' y2='9' stroke='#e2e8f0' strokeWidth='2' />
				<line x1='9' y1='9' x2='9' y2='22' stroke='#e2e8f0' strokeWidth='2' />
			</svg>
		</div>,
		{ ...size }
	);
}
