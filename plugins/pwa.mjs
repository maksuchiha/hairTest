import { VitePWA } from 'vite-plugin-pwa';

export function createPwaPlugin({ app }) {
	return VitePWA({
		// Автовставка регистрации в проде
		injectRegister: 'auto',
		registerType: 'autoUpdate',

		manifestFilename: 'manifest.webmanifest',
		manifest: {
			name: app.name,
			short_name: app.shortName,
			start_url: app.startUrl || '/',
			scope: app.scope || '/',
			id: app.id || '/',
			display: 'standalone',
			theme_color: app.themeColor,
			background_color: app.backgroundColor,
			icons: [
				{ src: 'img/favicons/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
				{ src: 'img/favicons/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
				// важна maskable-иконка для Android
				{
					src: 'img/favicons/android-chrome-512x512.png',
					sizes: '512x512',
					type: 'image/png',
					purpose: 'any maskable',
				},
				{ src: 'img/favicons/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
				{ src: 'img/favicons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
			],
			// при желании: screenshots/shortcuts/categories/orientation/lang/dir
		},

		workbox: {
			navigateFallback: 'index.html',
			// КРИТИЧНО для Bitrix: не подменяем API и PHP SPA-фолбэком
			navigateFallbackDenylist: [
				/^\/api\//,
				/^\/bitrix\//, // системные пути Bitrix
				/^\/upload\//, // файлы/медиа Bitrix
				/^\/local\//, // часто тут ajax-ручки
				/\.php($|\?)/i, // любые php-скрипты
				/\.(json|txt|xml)($|\?)/i,
			],

			// Чуть больше лимит на ассеты (часто большие vendor чанки)
			maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,

			globPatterns: ['**/*.{js,css,html,woff2,woff,ttf,otf,svg,png,webp,avif}'],
			globIgnores: ['**/*.map', '**/*.zip', '**/*.mp4'],

			cleanupOutdatedCaches: true, // чистим старые версии кэшей при деплое
			skipWaiting: true,
			clientsClaim: true,

			runtimeCaching: [
				{
					urlPattern: ({ request }) => request.mode === 'navigate',
					handler: 'NetworkFirst',
					options: {
						cacheName: 'html-pages',
						networkTimeoutSeconds: 4,
						expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 7 },
					},
				},
				{
					urlPattern: ({ request }) => request.destination === 'font',
					handler: 'CacheFirst',
					options: {
						cacheName: 'fonts',
						rangeRequests: true, // помогает для частичных запросов
						expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
					},
				},
				{
					urlPattern: ({ request }) => request.destination === 'image',
					handler: 'StaleWhileRevalidate',
					options: {
						cacheName: 'images',
						expiration: { maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 30 },
					},
				},
				// Пример для CDN‑картинок, если используешь внешний домен
				// {
				// urlPattern: /https?:\/\/(?:cdn\.example\.com)\//,
				// handler: 'StaleWhileRevalidate',
				// options: { cacheName: 'cdn-images' },
				// },
			],
		},

		// Включай на время отладки, затем выключай
		devOptions: { enabled: false },
	});
}
