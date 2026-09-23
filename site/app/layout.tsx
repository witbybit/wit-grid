import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';

export const metadata: Metadata = {
	title: {
		default: 'Wit Grid',
		template: '%s | Wit Grid',
	},
	description: 'Documentation for Wit Grid.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang='en' suppressHydrationWarning>
			<body>
				<RootProvider
					theme={{
						defaultTheme: 'light',
						enableSystem: false,
					}}
				>
					{children}
				</RootProvider>
			</body>
		</html>
	);
}
