// Shared OG/Twitter card renderer — imported by opengraph-image.tsx and twitter-image.tsx.
// Not a route itself: Next.js only treats the exact filenames `opengraph-image.tsx` /
// `twitter-image.tsx` as image-generation routes.
import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function renderCard() {
	return new ImageResponse(
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'center',
				padding: '80px',
				background: 'linear-gradient(135deg, #0a0d12 0%, #0f172a 100%)',
				color: '#e7edf7',
				fontFamily: 'sans-serif',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
				<svg width='40' height='40' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
					<rect x='2' y='2' width='20' height='20' rx='2' stroke='#60a5fa' strokeWidth='2' />
					<line x1='2' y1='9' x2='22' y2='9' stroke='#60a5fa' strokeWidth='2' />
					<line x1='9' y1='9' x2='9' y2='22' stroke='#60a5fa' strokeWidth='2' />
				</svg>
				<span style={{ fontSize: 32, fontWeight: 700, letterSpacing: -1 }}>Wit Grid</span>
			</div>
			<div style={{ display: 'flex', marginTop: 40, fontSize: 56, fontWeight: 700, letterSpacing: -2, maxWidth: 900, lineHeight: 1.15 }}>
				A framework-agnostic grid engine for massive, editable datasets.
			</div>
			<div style={{ display: 'flex', marginTop: 32, fontSize: 26, color: '#9aa6b7' }}>
				Client, infinite &amp; server row models · grouping · master-detail · themes
			</div>
		</div>,
		{ ...size }
	);
}
