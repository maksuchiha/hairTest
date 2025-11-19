import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcssPresetEnv from 'postcss-preset-env';
import { faviconsPlugin } from './plugins/favicons-plugin.mjs';
import { createPwaPlugin } from './plugins/pwa.mjs';
import { viteWebpAutoPicture } from './plugins/vite-webp-auto-picture.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP = {
	name: 'Тестовое Стайлер',
	shortName: 'Стайлер',
	themeColor: '#ffffff',
	backgroundColor: '#ffffff',
	startUrl: './',
};

export default defineConfig(({ mode }) => ({
	root: 'src',
	base: './',
	esbuild: {
		charset: 'ascii',
		legalComments: 'none',
	},
	optimizeDeps: {
		esbuildOptions: {
			charset: 'ascii',
		},
	},
	build: {
		outDir: path.resolve(__dirname, 'dist'),
		emptyOutDir: true,
		sourcemap: mode === 'development',
		minify: 'esbuild',
		manifest: true,
		cssCodeSplit: true,
		assetsInlineLimit: 0,
		assetsDir: 'img',
		target: 'es2020',
		treeshake: true,
		rollupOptions: {
			input: {
				index: path.resolve(__dirname, 'src/index.html'),
			},
			output: {
				entryFileNames: 'script/[name]-[hash].js',
				chunkFileNames: 'script/[name]-[hash].js',
				assetFileNames: (assetInfo) => {
					const name = assetInfo.name || '';
					const ext = name.slice(name.lastIndexOf('.')).toLowerCase();

					if (/^img[\\/]+favicons[\\/]+/i.test(name)) {
						return 'img/favicons/[name][extname]';
					}
					if (ext === '.css') return 'style/[name]-[hash][extname]';
					if (/\.(png|jpe?g|svg|gif|webp|avif)$/i.test(ext)) return 'img/[name]-[hash][extname]';
					if (/\.(woff2?|eot|ttf|otf)$/i.test(ext)) return 'fonts/[name]-[hash][extname]';
					return 'assets/[name]-[hash][extname]';
				},
				manualChunks(id) {
					if (id.includes('node_modules')) return 'vendor';
				},
			},
		},
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			'@style': path.resolve(__dirname, './src/style'),
			'@script': path.resolve(__dirname, './src/script'),
			'@img': path.resolve(__dirname, './src/img'),
		},
	},
	css: {
		devSourcemap: true,
		postcss: { plugins: [postcssPresetEnv()] },
	},
	server: { port: 3000, open: true },
	plugins: [
		viteWebpAutoPicture({
			skipExternal: true,
			webpOptions: { quality: 82 },
			cacheFile: '.idea/vite-webp-auto-picture.json',
		}),
		faviconsPlugin({
			src: path.resolve(__dirname, 'src/img/favicons/favicon.svg'),
			app: APP,
			publicPrefix: './img/favicons/',
		}),
		createPwaPlugin({
			app: APP,
		}),
	],
}));
