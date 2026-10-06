/** @type {import('tailwindcss').Config} */
export default {
	content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '../packages/examples/src/**/*.{ts,tsx}'],
	theme: {
		extend: {
			colors: {
				grid: {
					border: 'rgb(229 231 235)', // border-gray-200
					focus: '#3b82f6', // blue-500
					selected: 'rgba(59, 130, 246, 0.1)', // transparent blue
				},
			},
		},
	},
	plugins: [],
};
