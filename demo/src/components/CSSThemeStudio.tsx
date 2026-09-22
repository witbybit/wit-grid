import React, { useState, useCallback } from 'react';
import { BUILT_IN_THEMES, type BuiltInThemeName, type ThemeTokens } from '@eregister/wit-grid-react';

interface CSSThemeStudioProps {
	onThemeSelect?: (themeName: BuiltInThemeName, theme: ThemeTokens) => void;
}

/**
 * CSS Theme Studio - Interactive showcase for Wit Grid themes
 *
 * Demonstrates:
 * - All built-in themes (light, dark, high-contrast, branded, minimal)
 * - Live preview with instant switching
 * - Theme token inspection
 * - Custom theme creation
 */
export const CSSThemeStudio: React.FC<CSSThemeStudioProps> = ({ onThemeSelect }) => {
	const [selectedTheme, setSelectedTheme] = useState<BuiltInThemeName>('dark');
	const [showTokens, setShowTokens] = useState(false);

	const themes: { name: BuiltInThemeName; label: string; description: string }[] = [
		{ name: 'light', label: 'Light', description: 'Clean, professional light theme' },
		{ name: 'dark', label: 'Dark', description: 'High contrast dark theme (default)' },
		{ name: 'light-hc', label: 'Light HC', description: 'Enhanced light contrast (a11y)' },
		{ name: 'dark-hc', label: 'Dark HC', description: 'Enhanced dark contrast (a11y)' },
		{ name: 'cool-blue', label: 'Cool Blue', description: 'Modern tech aesthetic' },
		{ name: 'warm-orange', label: 'Warm Orange', description: 'Energetic aesthetic' },
		{ name: 'minimal-monochrome', label: 'Monochrome', description: 'Ultra-clean minimalist' },
	];

	const currentTheme = BUILT_IN_THEMES[selectedTheme];

	const handleThemeSelect = useCallback(
		(themeName: BuiltInThemeName) => {
			setSelectedTheme(themeName);
			const theme = BUILT_IN_THEMES[themeName];
			onThemeSelect?.(themeName, theme);
		},
		[onThemeSelect]
	);

	return (
		<div className='theme-studio'>
			<div className='theme-studio-header'>
				<h2>CSS Theme Studio</h2>
				<p>Advanced theming system for Wit Grid. Switch themes, inspect tokens, and customize colors.</p>
			</div>

			{/* Theme Grid */}
			<div className='theme-studio-grid'>
				{themes.map(({ name, label, description }) => (
					<button
						key={name}
						className={`theme-card ${selectedTheme === name ? 'theme-card-active' : ''}`}
						onClick={() => handleThemeSelect(name)}
						title={description}
					>
						<div className='theme-card-preview'>
							<div className='theme-color-swatch' style={{ backgroundColor: BUILT_IN_THEMES[name].bgColor }} />
							<div className='theme-color-swatch' style={{ backgroundColor: BUILT_IN_THEMES[name].headerBg }} />
							<div className='theme-color-swatch' style={{ backgroundColor: BUILT_IN_THEMES[name].focusRing }} />
						</div>
						<div className='theme-card-label'>{label}</div>
					</button>
				))}
			</div>

			{/* Token Inspector */}
			<div className='theme-studio-inspector'>
				<div className='inspector-header'>
					<h3>Theme Tokens</h3>
					<button className='inspector-toggle' onClick={() => setShowTokens(!showTokens)}>
						{showTokens ? 'Hide' : 'Show'} Tokens
					</button>
				</div>

				{showTokens && (
					<div className='inspector-content'>
						<div className='token-grid'>
							{/* Colors Section */}
							<div className='token-section'>
								<h4>Base Colors</h4>
								<div className='token-items'>
									<TokenItem label='Background' value={currentTheme.bgColor} />
									<TokenItem label='Text' value={currentTheme.textColor} />
									<TokenItem label='Border' value={currentTheme.borderColor} />
									<TokenItem label='Focus Ring' value={currentTheme.focusRing} />
								</div>
							</div>

							{/* Header Section */}
							<div className='token-section'>
								<h4>Header</h4>
								<div className='token-items'>
									<TokenItem label='Header BG' value={currentTheme.headerBg} />
									<TokenItem label='Header Text' value={currentTheme.headerText} />
								</div>
							</div>

							{/* Row Section */}
							<div className='token-section'>
								<h4>Rows & Selection</h4>
								<div className='token-items'>
									<TokenItem label='Row Hover BG' value={currentTheme.rowHoverBg} />
									<TokenItem label='Selection BG' value={currentTheme.selectionBg} />
									<TokenItem label='Selection Border' value={currentTheme.selectionBorder} />
								</div>
							</div>

							{/* Group Section */}
							<div className='token-section'>
								<h4>Groups</h4>
								<div className='token-items'>
									<TokenItem label='Group Row BG' value={currentTheme.groupRowBg} />
									<TokenItem label='Group Badge BG' value={currentTheme.groupBadgeBg} />
									<TokenItem label='Group Badge Text' value={currentTheme.groupBadgeText} />
								</div>
							</div>

							{/* Popover Section */}
							<div className='token-section'>
								<h4>Popovers & Menus</h4>
								<div className='token-items'>
									<TokenItem label='Popover BG' value={currentTheme.popoverBg} />
									<TokenItem label='Popover Text' value={currentTheme.popoverText} />
									<TokenItem label='Item Hover BG' value={currentTheme.popoverItemHoverBg} />
									<TokenItem label='Item Active BG' value={currentTheme.popoverItemActiveBg} />
								</div>
							</div>

							{/* Skeleton Section */}
							<div className='token-section'>
								<h4>Loading States</h4>
								<div className='token-items'>
									<TokenItem label='Skeleton Start' value={currentTheme.skeletonStart} />
									<TokenItem label='Skeleton Mid' value={currentTheme.skeletonMid} />
								</div>
							</div>
						</div>

						{/* Export Code */}
						<div className='export-section'>
							<h4>Export Theme Configuration</h4>
							<CopyableCode
								code={`import { ThemeManager, createTheme } from '@eregister/wit-grid-react';

// Use a built-in theme as-is
api.switchTheme('${selectedTheme}');

// Or build a themed variant — ThemeTokens is a plain object, so overrides are just a spread
const customTheme: ThemeTokens = {
  ...getBuiltInTheme('${selectedTheme}'),
  bgColor: '${currentTheme.bgColor}',
  textColor: '${currentTheme.textColor}',
  focusRing: '${currentTheme.focusRing}',
  // ... override other tokens
};
api.setTheme(customTheme);`}
							/>
						</div>
					</div>
				)}
			</div>

			<style>{`
        .theme-studio {
          padding: 24px;
          background: var(--og-bg-color);
          color: var(--og-text-color);
          font-family: var(--og-font-family);
        }

        .theme-studio-header {
          margin-bottom: 32px;
        }

        .theme-studio-header h2 {
          margin: 0 0 8px 0;
          font-size: 24px;
          font-weight: 700;
        }

        .theme-studio-header p {
          margin: 0;
          opacity: 0.75;
          font-size: 14px;
        }

        .theme-studio-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 12px;
          margin-bottom: 32px;
        }

        .theme-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          border: 2px solid var(--og-border-color);
          border-radius: 8px;
          background: transparent;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .theme-card:hover {
          border-color: var(--og-focus-ring);
          transform: translateY(-2px);
        }

        .theme-card-active {
          border-color: var(--og-focus-ring);
          background: rgba(59, 130, 246, 0.05);
        }

        .theme-card-preview {
          display: flex;
          gap: 6px;
          height: 40px;
        }

        .theme-color-swatch {
          flex: 1;
          border-radius: 4px;
          border: 1px solid var(--og-border-color);
        }

        .theme-card-label {
          font-size: 13px;
          font-weight: 600;
          text-align: center;
        }

        .theme-studio-inspector {
          margin-top: 32px;
          padding: 16px;
          border: 1px solid var(--og-border-color);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.02);
        }

        .inspector-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .inspector-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }

        .inspector-toggle {
          padding: 6px 12px;
          border: 1px solid var(--og-border-color);
          border-radius: 4px;
          background: var(--og-header-bg);
          color: var(--og-text-color);
          cursor: pointer;
          font-size: 12px;
          transition: all 0.12s ease;
        }

        .inspector-toggle:hover {
          background: rgba(255, 255, 255, 0.08);
        }

        .inspector-content {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .token-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 16px;
        }

        .token-section {
          padding: 12px;
          border: 1px solid var(--og-border-color);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.01);
        }

        .token-section h4 {
          margin: 0 0 12px 0;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          opacity: 0.7;
        }

        .token-items {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .token-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 0;
        }

        .token-color-swatch {
          width: 32px;
          height: 32px;
          border-radius: 4px;
          border: 1px solid var(--og-border-color);
          flex-shrink: 0;
        }

        .token-label {
          font-size: 12px;
          font-weight: 500;
          min-width: 100px;
        }

        .token-value {
          font-size: 11px;
          font-family: 'Monaco', 'Courier', monospace;
          opacity: 0.75;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .export-section {
          margin-top: 16px;
          padding: 12px;
          border: 1px solid var(--og-border-color);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.01);
        }

        .export-section h4 {
          margin: 0 0 12px 0;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          opacity: 0.7;
        }

        .copyable-code {
          position: relative;
        }

        .code-pre {
          margin: 0;
          padding: 12px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 4px;
          border: 1px solid var(--og-border-color);
          overflow-x: auto;
          font-size: 11px;
          font-family: 'Monaco', 'Courier', monospace;
          line-height: 1.5;
        }

        .copy-button {
          position: absolute;
          top: 8px;
          right: 8px;
          padding: 4px 8px;
          border: 1px solid var(--og-border-color);
          border-radius: 4px;
          background: var(--og-header-bg);
          color: var(--og-text-color);
          cursor: pointer;
          font-size: 11px;
          transition: all 0.12s ease;
        }

        .copy-button:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `}</style>
		</div>
	);
};

const TokenItem: React.FC<{ label: string; value: string }> = ({ label, value }) => {
	return (
		<div className='token-item'>
			<div className='token-color-swatch' style={{ backgroundColor: value }} title={value} />
			<div className='token-label'>{label}</div>
			<div className='token-value' title={value}>
				{value}
			</div>
		</div>
	);
};

const CopyableCode: React.FC<{ code: string }> = ({ code }) => {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			console.error('Failed to copy');
		}
	};

	return (
		<div className='copyable-code'>
			<pre className='code-pre'>{code}</pre>
			<button className='copy-button' onClick={handleCopy}>
				{copied ? 'Copied!' : 'Copy'}
			</button>
		</div>
	);
};
