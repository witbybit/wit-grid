import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { SITE_URL } from '@/lib/site-url';
import './global.css';

const description = 'A framework-agnostic grid engine for massive, editable datasets — documentation, guides, and live examples.';

export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),
	title: {
		default: 'Wit Grid',
		template: '%s | Wit Grid',
	},
	description,
	openGraph: {
		title: 'Wit Grid',
		description,
		siteName: 'Wit Grid',
		type: 'website',
	},
	twitter: {
		card: 'summary_large_image',
		title: 'Wit Grid',
		description,
	},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang='en' suppressHydrationWarning>
			<body>
				<RootProvider
					theme={{
						defaultTheme: 'system',
						enableSystem: true,
					}}
				>
					{children}
				</RootProvider>
			</body>
		</html>
	);
}
