import { WitGridWordmark } from '@/components/brand/wit-grid-mark';

/** Light beams travelling along the background grid lines: [axis, position on the 48px grid, delay s, duration s]. */
const BEAMS: ['h' | 'v', number, number, number][] = [
	['h', 2, 0, 7],
	['h', 5, 2.4, 9],
	['h', 8, 4.8, 8],
	['v', 3, 1.2, 8],
	['v', 10, 3.6, 10],
	['v', 17, 0.6, 9],
	['v', 22, 5.2, 7.5],
];

/** The landing page's brand: the mark, a big wordmark, and a living grid behind them. */
export function BrandHero() {
	return (
		<section className='wg-brand' aria-label='Wit Grid'>
			<div className='wg-brand-stage' aria-hidden>
				<div className='wg-brand-floor' />
				<div className='wg-brand-glow wg-brand-glow-a' />
				<div className='wg-brand-glow wg-brand-glow-b' />
				{BEAMS.map(([axis, line, delay, duration], i) => (
					<span
						key={i}
						className={axis === 'h' ? 'wg-beam wg-beam-h' : 'wg-beam wg-beam-v'}
						style={{ [axis === 'h' ? 'top' : 'left']: `${line * 48}px`, animationDelay: `${delay}s`, animationDuration: `${duration}s` }}
					/>
				))}
			</div>
			<div className='wg-brand-lockup'>
				<h1 className='wg-wordmark'>
					<WitGridWordmark animated />
				</h1>
			</div>
			<svg className='wg-brand-underline' viewBox='0 0 600 24' preserveAspectRatio='none' aria-hidden>
				<defs>
					<linearGradient id='wg-underline' x1='0' x2='600' y1='0' y2='0' gradientUnits='userSpaceOnUse'>
						<stop stopColor='#38bdf8' stopOpacity='0' />
						<stop offset='0.2' stopColor='#38bdf8' />
						<stop offset='0.6' stopColor='#6d7cff' />
						<stop offset='1' stopColor='#a855f7' stopOpacity='0' />
					</linearGradient>
				</defs>
				<path
					d='M4 16 C 140 4, 300 22, 596 8'
					stroke='url(#wg-underline)'
					strokeWidth='3'
					fill='none'
					strokeLinecap='round'
					pathLength='100'
				/>
			</svg>
			<p className='wg-brand-tagline'>
				The data grid that keeps up: <strong>live</strong>, <strong>editable</strong> and <strong>themeable</strong>, on a framework-agnostic
				core.
			</p>
		</section>
	);
}
