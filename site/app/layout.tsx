import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { SITE_URL } from '@/lib/site-url';
import { SiteFooter } from '@/components/site-footer';
import { BUILT_IN_THEME_FONTS_URL } from '@eregister/wit-grid-react';
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
			<head>
				{/* The built-in grid themes' fonts (the hero switches themes). */}
				<link rel='preconnect' href='https://fonts.googleapis.com' />
				<link rel='preconnect' href='https://fonts.gstatic.com' crossOrigin='' />
				<link rel='stylesheet' href={BUILT_IN_THEME_FONTS_URL} />
			</head>
			<body>
				<RootProvider
					theme={{
						defaultTheme: 'system',
						enableSystem: true,
					}}
				>
					{children}
					<SiteFooter />
				</RootProvider>
			</body>
		</html>
	);
}
