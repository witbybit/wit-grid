/** @type {import('tailwindcss').Config} */
export default {
	content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
	theme: {
		extend: {
			boxShadow: {
				soft: '0 24px 80px rgba(15, 23, 42, 0.08)',
				button: '0 14px 30px rgba(17, 24, 39, 0.2)',
				mark: '0 10px 28px rgba(17, 24, 39, 0.18)',
			},
			fontFamily: {
				sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
				mono: ['SFMono-Regular', 'Consolas', 'Liberation Mono', 'monospace'],
			},
			colors: {
				ink: '#111827',
				canvas: '#f7f8fb',
			},
		},
	},
	plugins: [],
};
