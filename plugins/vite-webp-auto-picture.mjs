import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const PL_NAME = 'vite-webp-auto-picture';

export const viteWebpAutoPicture = (options = {}) => {
	const {
		includeExt = ['.png', '.jpg', '.jpeg'],
		skipExternal = true,
		warnOnMissingFile = true,
		concurrency = 'auto',
		cacheFile = '.cache/vite-webp-auto-picture.json',
		webpOptions = { quality: 82 },
		applyMode,
	} = options;

	// ---------- shared lazy singletons for heavy/optional deps ----------
	const mods = {};
	const m = async (name) => (mods[name] ??= await import(name));

	// ---------- constants & regex ----------
	const CACHE_VERSION = 2;
	const cleanExts = includeExt.filter(Boolean).map((e) => e.replace(/^\./, ''));
	const extsRe = cleanExts.length ? new RegExp(`\\.(${cleanExts.join('|')})(\\?.*?)?$`, 'i') : null;
	const pngJpgRe = /\.(png|jpe?g)(\?.*?)?$/i;
	const svgRe = /\.svg(\?.*?)?$/i;
	const webpRe = /\.webp(\?.*?)?$/i;
	const isExternal = (u) => /^https?:\/\//i.test(u) || /^data:/i.test(u) || /^\/\//.test(u);
	const toWebpPath = (url) => url.replace(pngJpgRe, '.webp$2');
	const normalizeWs = (s) => String(s).replace(/\s+/g, ' ').trim();

	// ---------- mutable env (vite provides later) ----------
	let command = 'serve';
	let outDir = 'dist';
	let projectRoot = process.cwd();

	// ---------- cache ----------
	let cache = { version: CACHE_VERSION, files: {} };
	let cacheDirty = false;
	let __nhp;

	async function loadCache() {
		try {
			const full = path.resolve(process.cwd(), cacheFile);
			await fsp.mkdir(path.dirname(full), { recursive: true });
			const raw = await fsp.readFile(full, 'utf8');
			const json = JSON.parse(raw);
			if (json?.version === CACHE_VERSION && json.files) cache = json;
		} catch {
			/* no cache yet */
		}
	}

	async function saveCache() {
		if (!cacheDirty) return;
		try {
			const full = path.resolve(process.cwd(), cacheFile);
			await fsp.mkdir(path.dirname(full), { recursive: true });
			await fsp.writeFile(full, JSON.stringify(cache, null, 2), 'utf8');
			cacheDirty = false;
		} catch {
			/* ignore cache write errors */
		}
	}

	async function sha1File(fileAbsPath) {
		const hash = crypto.createHash('sha1');
		const stream = fs.createReadStream(fileAbsPath);
		return new Promise((resolve, reject) => {
			stream.on('data', (d) => hash.update(d));
			stream.on('end', () => resolve(hash.digest('hex')));
			stream.on('error', reject);
		});
	}

	function updateCache(key, stat, hash) {
		cache.files[key] = { size: stat.size, mtimeMs: stat.mtimeMs, hash, webpOptions };
		cacheDirty = true;
	}

	// ---------- build: generate webp in outDir ----------
	async function generateWebpRecursively(baseDir, context) {
		await loadCache();

		const limits =
			typeof concurrency === 'number' && concurrency > 0
				? concurrency
				: Math.max(2, Math.min(8, os.cpus()?.length || 4));

		const jobPaths = [];
		const outPathOf = (input) => input.replace(pngJpgRe, '.webp');

		let imagemin;
		let imageminWebp;
		async function ensureImagemin() {
			if (imagemin && imageminWebp) return;
			imagemin = (await m('imagemin')).default;
			imageminWebp = (await m('imagemin-webp')).default;
		}

		async function convertToWebpInPlace(inputAbs) {
			await ensureImagemin();
			await imagemin([inputAbs], {
				destination: path.dirname(inputAbs),
				plugins: [imageminWebp(webpOptions)],
			});
		}

		async function ensureConvert(inputAbs) {
			if ((extsRe && !extsRe.test(inputAbs)) || !pngJpgRe.test(inputAbs)) return;

			const outAbs = outPathOf(inputAbs);
			const key = path.resolve(inputAbs);

			try {
				const stat = await fsp.stat(inputAbs);

				try {
					await fsp.access(outAbs);
				} catch {
					const hash = await sha1File(inputAbs);
					await convertToWebpInPlace(inputAbs);
					updateCache(key, stat, hash);
					return;
				}

				const prev = cache.files[key];

				if (!prev) {
					const hash = await sha1File(inputAbs);
					await convertToWebpInPlace(inputAbs);
					updateCache(key, stat, hash);
					return;
				}

				// вход не менялся, но опции сменились → пересобрать
				if (prev.size === stat.size && prev.mtimeMs === stat.mtimeMs) {
					if (JSON.stringify(prev.webpOptions) !== JSON.stringify(webpOptions)) {
						await convertToWebpInPlace(inputAbs);
						const hash = await sha1File(inputAbs);
						updateCache(key, stat, hash);
					}
					return;
				}

				// вход менялся → сверяем хэш и опции
				const hash = await sha1File(inputAbs);
				if (prev.hash !== hash || JSON.stringify(prev.webpOptions) !== JSON.stringify(webpOptions)) {
					await convertToWebpInPlace(inputAbs);
				}
				updateCache(key, stat, hash);
			} catch (e) {
				if (warnOnMissingFile && e?.code === 'ENOENT') context?.warn?.(`[${PL_NAME}] Пропуск: не найден файл ${inputAbs}`);
			}
		}

		async function walk(dir) {
			if (!fs.existsSync(dir)) return;
			const entries = await fsp.readdir(dir, { withFileTypes: true });
			for (const e of entries) {
				const full = path.join(dir, e.name);
				if (e.isDirectory()) {
					await walk(full);
				} else {
					if ((!extsRe || extsRe.test(full)) && pngJpgRe.test(full) && !webpRe.test(full)) jobPaths.push(full);
				}
			}
		}

		await walk(baseDir);

		let idx = 0;
		async function worker() {
			for (;;) {
				const i = idx++;
				if (i >= jobPaths.length) break;
				await ensureConvert(jobPaths[i]);
			}
		}

		await Promise.all(Array.from({ length: limits }, worker));
		await saveCache();
	}

	// ---------- DOM helpers ----------
	function parseSrcset(srcset = '') {
		if (typeof srcset !== 'string') return [];
		return srcset
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((item) => {
				const m = item.match(/^(\S+)(\s+.+)?$/);
				return { url: m ? m[1] : item, descriptor: m?.[2]?.trim() || '' };
			});
	}

	function buildSrcset(list = []) {
		return list.map(({ url, descriptor }) => (descriptor ? `${url} ${descriptor}` : url)).join(', ');
	}

	function isInsidePicture(node) {
		let p = node?.parentNode;
		while (p) {
			if (p.tagName?.toLowerCase?.() === 'picture') return true;
			p = p.parentNode;
		}
		return false;
	}

	function escapeAttr(val) {
		return String(val).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	function attrsToString(attrs = {}) {
		return Object.entries(attrs)
			.filter(([, v]) => v !== undefined && v !== null && v !== false)
			.map(([k, v]) => (v === true ? k : `${k}="${escapeAttr(v)}"`))
			.join(' ');
	}

	function createElement(parse, tag, attrs = {}, selfClose = false) {
		const attr = attrsToString(attrs);
		const html = selfClose ? `<${tag}${attr ? ' ' + attr : ''} />` : `<${tag}${attr ? ' ' + attr : ''}></${tag}>`;
		return parse(html).childNodes[0];
	}

	function insertBefore(refNode, newNode) {
		const parent = refNode?.parentNode;
		if (!parent) return;
		const i = parent.childNodes.indexOf(refNode);
		if (i === -1) parent.appendChild(newNode);
		else {
			parent.childNodes.splice(i, 0, newNode);
			newNode.parentNode = parent;
		}
	}

	// ——— чуть более устойчивый импорт node-html-parser под ESM/CJS
	async function getParser() {
		if (!__nhp) {
			const mod = await import('node-html-parser');
			// В разных сборках export может отличаться
			const parse =
				mod.parse ??
				mod.default?.parse ??
				(typeof mod.default === 'function' ? mod.default : undefined) ??
				mod;
			if (typeof parse !== 'function') {
				throw new Error(`${PL_NAME}: не удалось получить parse() из node-html-parser`);
			}
			__nhp = { parse };
		}
		return __nhp;
	}

	// Подпись srcset — нормализуем пробелы, сортируем, чтобы сравнение было идемпотентным
	function srcsetSignature(srcset) {
		const items = normalizeWs(srcset)
			.split(',')
			.map((x) => x.trim())
			.filter(Boolean);
		return items.sort().join(',');
	}

	// Вычисляем webp-кандидат для <img>, учитывая srcset или src
	function computeImgWebpSrcset(imgEl) {
		const src = imgEl.getAttribute?.('src') || '';
		const srcset = imgEl.getAttribute?.('srcset') || '';

		if (srcset) {
			const parts = parseSrcset(srcset).filter(
				({ url }) => (!skipExternal || !isExternal(url)) && pngJpgRe.test(url) && !svgRe.test(url)
			);
			if (parts.length) return buildSrcset(parts.map(({ url, descriptor }) => ({ url: toWebpPath(url), descriptor })));
			return '';
		}

		if (src && (!skipExternal || !isExternal(src)) && pngJpgRe.test(src) && !svgRe.test(src)) return toWebpPath(src);
		return '';
	}

	// NEW: безопасный гейт, чтобы не вставлять дубль webp-<source> с тем же media/srcset
	function hasEquivalentWebpSource(existingSet, srcset, media, sizes) {
		const key = `${srcsetSignature(srcset)}|${normalizeWs(media || '')}|${normalizeWs(sizes || '')}`;
		return existingSet.has(key);
	}
	function putEquivalentWebpSource(existingSet, srcset, media, sizes) {
		const key = `${srcsetSignature(srcset)}|${normalizeWs(media || '')}|${normalizeWs(sizes || '')}`;
		existingSet.add(key);
	}

	async function enhanceDOM(html, { injectWebpSources }) {
		const { parse } = await getParser();
		const root = parse(html, {
			lowerCaseTagName: false,
			comment: true,
			blockTextElements: { script: true, style: true, pre: true },
		});

		// 1) Существующие <picture>: перед каждым <source ...> без webp вставляем его webp-отражение
		if (injectWebpSources) {
			const pictures = root.querySelectorAll('picture') || [];
			for (const pic of pictures) {
				const sources = pic.querySelectorAll('source') || [];

				// множество уже существующих webp-источников (учёт media/sizes, чтобы не дублировать)
				const existingWebp = new Set();
				for (const s of sources) {
					const type = s.getAttribute?.('type') || '';
					if (/image\/webp/i.test(type)) {
						const sset = s.getAttribute?.('srcset') || '';
						const media = s.getAttribute?.('media') || '';
						const sizes = s.getAttribute?.('sizes') || '';
						if (sset) putEquivalentWebpSource(existingWebp, sset, media, sizes);
					}
				}

				// a) Пройдемся по каждому НЕ webp <source> и вставим его webp-зеркало (с теми же media/sizes)
				for (const s of sources) {
					const type = s.getAttribute?.('type') || '';
					if (/image\/webp/i.test(type)) continue;

					const srcset = s.getAttribute?.('srcset') || '';
					if (!srcset) continue;

					const media = s.getAttribute?.('media');
					const sizes = s.getAttribute?.('sizes');

					const parts = parseSrcset(srcset);
					if (!parts.length) continue;

					const webpParts = parts
						.filter(({ url }) => (!skipExternal || !isExternal(url)) && pngJpgRe.test(url) && !svgRe.test(url))
						.map(({ url, descriptor }) => ({ url: toWebpPath(url), descriptor }));

					if (!webpParts.length) continue;

					const webpSrcset = buildSrcset(webpParts);

					if (!hasEquivalentWebpSource(existingWebp, webpSrcset, media, sizes)) {
						const webpSource = createElement(
							parse,
							'source',
							{ srcset: webpSrcset, type: 'image/webp', ...(media && { media }), ...(sizes && { sizes }) },
							true
						);
						insertBefore(s, webpSource);
						putEquivalentWebpSource(existingWebp, webpSrcset, media, sizes);
					}
				}

				// b) Убедимся, что <img> внутри <picture> тоже имеет webp-кандидат как отдельный <source>
				const img = pic.querySelector('img');
				if (img) {
					const candidate = computeImgWebpSrcset(img);
					if (candidate) {
						// для <img> не задаём media/sizes — эти атрибуты остаются у «верхних» <source>
						if (!hasEquivalentWebpSource(existingWebp, candidate, '', '')) {
							const srcEl = createElement(parse, 'source', { srcset: candidate, type: 'image/webp' }, true);
							insertBefore(img, srcEl);
							putEquivalentWebpSource(existingWebp, candidate, '', '');
						}
					}
				}
			}
		}

		// 2) Одиночные <img> → оборачиваем в <picture> и добавляем webp <source> (как было раньше)
		const imgs = root.querySelectorAll('img') || [];
		for (const img of imgs) {
			if (isInsidePicture(img)) continue;

			const candidate = injectWebpSources ? computeImgWebpSrcset(img) : '';
			if (!candidate) continue;

			const picture = createElement(parse, 'picture');
			picture.appendChild(createElement(parse, 'source', { srcset: candidate, type: 'image/webp' }, true));
			const parent = img.parentNode;
			if (!parent) continue;
			const idx = parent.childNodes.indexOf(img);
			if (idx === -1) continue;
			parent.childNodes.splice(idx, 1, picture);
			picture.parentNode = parent;
			picture.appendChild(img);
		}

		return root.toString(); // node-html-parser сам корректно сериализует self-closed <source/>
	}

	// ---------- DEV middleware: on-the-fly webp ----------
	function makeDevWebpMiddleware() {
		const mem = new Map(); // key: abs|mtime|opts -> Buffer

		async function convertBuffer(inputAbs) {
			let sharp;
			try {
				sharp = (await m('sharp')).default;
			} catch {
				// Без sharp надёжного in-memory fallback для dev нет — пропускаем
				return null;
			}
			const st = await fsp.stat(inputAbs);
			const key = `${inputAbs}|${st.mtimeMs}|${JSON.stringify(webpOptions)}`;
			if (mem.has(key)) return mem.get(key);

			const buf = await sharp(await fsp.readFile(inputAbs)).webp(webpOptions).toBuffer();
			mem.set(key, buf);
			if (mem.size > 200) mem.delete(mem.keys().next().value);
			return buf;
		}

		function tryResolveOriginalSync(absWebpPath) {
			const bases = [
				absWebpPath.replace(/\.webp(\?.*)?$/i, '.png'),
				absWebpPath.replace(/\.webp(\?.*)?$/i, '.jpg'),
				absWebpPath.replace(/\.webp(\?.*)?$/i, '.jpeg'),
				absWebpPath.replace(/\.webp(\?.*)?$/i, '.PNG'),
				absWebpPath.replace(/\.webp(\?.*)?$/i, '.JPG'),
				absWebpPath.replace(/\.webp(\?.*)?$/i, '.JPEG'),
			];
			for (const p of bases) if (fs.existsSync(p)) return path.resolve(p);
			return null;
		}

		return async function webpMiddleware(req, res, next) {
			try {
				if (req.method !== 'GET') return next();
				const [rawPath] = req.url.split('?', 2);
				if (!/\.webp$/i.test(rawPath)) return next();

				// /@fs/<abs-path>
				if (rawPath.startsWith('/@fs/')) {
					const abs = path.resolve('/', rawPath.replace(/^\/@fs\//, '/'));
					const srcAbs = tryResolveOriginalSync(abs);
					if (srcAbs) {
						const buf = await convertBuffer(srcAbs);
						if (!buf) return next();
						res.statusCode = 200;
						res.setHeader('Content-Type', 'image/webp');
						res.setHeader('Cache-Control', 'no-store');
						return res.end(buf);
					}
				}

				// project root or public/
				let absReq = path.resolve(projectRoot, '.' + rawPath);
				if (!fs.existsSync(absReq)) {
					const inPublic = path.resolve(projectRoot, 'public', '.' + rawPath);
					if (fs.existsSync(inPublic)) absReq = inPublic;
				}

				const srcPath = tryResolveOriginalSync(absReq);
				if (!srcPath) return next();

				const buf = await convertBuffer(srcPath);
				if (!buf) return next();
				res.statusCode = 200;
				res.setHeader('Content-Type', 'image/webp');
				res.setHeader('Cache-Control', 'no-store');
				res.end(buf);
			} catch {
				next();
			}
		};
	}

	// ---------- Vite hooks ----------
	return {
		name: PL_NAME,
		enforce: 'post', // после Vite URL rewrite
		apply: applyMode,
		async configResolved(resolved) {
			command = resolved.command; // 'serve' | 'build'
			outDir = resolved.build?.outDir || 'dist';
			projectRoot = resolved.root || process.cwd();
		},

		async transformIndexHtml(html) {
			try {
				const htmlStr = typeof html === 'string' ? html : (html?.html ?? String(html ?? ''));
				const out = await enhanceDOM(htmlStr, { injectWebpSources: true });
				return typeof out === 'string' ? out : (out?.html ?? String(out ?? htmlStr));
			} catch (e) {
				this.warn?.(`[${PL_NAME}] transformIndexHtml: ${e?.message || e}`);
				return typeof html === 'string' ? html : (html?.html ?? '');
			}
		},

		configureServer(server) {
			server.middlewares.use(makeDevWebpMiddleware());
		},

		async generateBundle(_options, bundle) {
			if (command !== 'build') return;
			try {
				for (const [, asset] of Object.entries(bundle)) {
					if (
						asset &&
						asset.type === 'asset' &&
						typeof asset.fileName === 'string' &&
						asset.fileName.endsWith('.html')
					) {
						const toStr = (x) =>
							typeof x === 'string' ? x : Buffer.isBuffer(x) ? x.toString('utf8') : String(x ?? '');
						const src = toStr(asset.source);
						const out = await enhanceDOM(src, { injectWebpSources: true });
						if (typeof out === 'string' && out !== src) asset.source = out;
					}
				}
			} catch (e) {
				this.warn?.(`[${PL_NAME}] generateBundle: ${e?.message || e}`);
			}
		},

		async writeBundle() {
			if (command !== 'build') return;
			try {
				await generateWebpRecursively(path.resolve(process.cwd(), outDir), this);
			} catch (e) {
				this.warn?.(`[${PL_NAME}] writeBundle: ${e?.message || e}`);
			}
		},
	};
};
