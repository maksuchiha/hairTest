import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';

/**
 * Генерирует PNG/ICO из SVG-источника и инжектит теги в HTML.
 * - НЕ эмитит manifest.* — его генерирует VitePWA.
 * - НЕ добавляет <link rel="manifest"> — пусть это делает VitePWA (учитывает base/scope).
 */
export function faviconsPlugin({ src, app, publicPrefix = './img/favicons/' }) {
	const outPublicPrefix = publicPrefix.endsWith('/') ? publicPrefix : `${publicPrefix}/`;
	let headHtml = '';

	return {
		name: 'favicons:generate-and-inject',
		apply: 'build',

		async buildStart() {
			// 1) Проверяем наличие исходного SVG
			try {
				await access(src, constants.F_OK);
			} catch {
				this.warn(`[faviconsPlugin] Файл favicon не найден по пути: ${src}. Генерация пропущена.`);
				return;
			}

			// 2) Импортируем favicons динамически и читаем исходник один раз
			const { default: favicons } = await import('favicons');
			const source = await readFile(src);

			// 3) Генерация ассетов
			let response;
			try {
				response = await favicons(source, {
					path: '',
					appName: app?.name,
					appShortName: app?.shortName,
					theme_color: app?.themeColor,
					background: app?.backgroundColor,
					start_url: app?.startUrl,
					icons: {
						android: true,
						appleIcon: true,
						appleStartup: false,
						favicons: true,
						windows: false,
						yandex: false,
						coast: false,
						firefox: false,
					},
				});
			} catch (e) {
				this.error(`[faviconsPlugin] Ошибка генерации: ${e?.message || e}`);
				return;
			}

			// 4) Исходный svg как favicon.svg
			this.emitFile({
				type: 'asset',
				fileName: 'img/favicons/favicon.svg',
				source,
			});

			// 5) PNG/ICO
			for (const img of response.images) {
				this.emitFile({ type: 'asset', fileName: `img/favicons/${img.name}`, source: img.contents });
			}

			// 6) Прочие файлы, кроме manifest.* (отдаём это VitePWA)
			for (const file of response.files) {
				const lower = file.name.toLowerCase();
				if (lower === 'manifest.json' || lower === 'manifest.webmanifest') continue;
				this.emitFile({ type: 'asset', fileName: `img/favicons/${file.name}`, source: file.contents });
			}

			// 7) Готовим теги для <head> (без <link rel="manifest">)
			const normalized = response.html
				// убираем manifest (вставляет VitePWA)
				.filter((tag) => !/rel=["']manifest["']/.test(tag))
				// убираем возможные дубликаты theme-color
				.filter((tag) => !/<meta[^>]+name=["']theme-color["']/i.test(tag))
				.map((tag) =>
					tag
						// абсолютные пути сайта, но НЕ protocol-relative //cdn...
						.replace(/href="\/(?!\/)/g, `href="${outPublicPrefix}`)
						// относительные пути без ./ или /
						.replace(/href="(?!\.|\/|https?:\/\/)([^"]+)"/g, (_m, file) => `href="${outPublicPrefix}${file}"`)
				)
				.filter((t, i, arr) => arr.indexOf(t) === i);

			headHtml = [
				`<meta name="theme-color" content="${app?.themeColor ?? ''}">`,
				`<link rel="icon" href="${outPublicPrefix}favicon.svg" sizes="any" type="image/svg+xml">`,
				...normalized,
			].join('\n');
		},

		transformIndexHtml(html) {
			if (!headHtml) return html;
			const marker = '</head>';
			const idx = html.indexOf(marker);
			if (idx === -1) return html;

			// Базовая индентация строки перед </head>
			const before = html.slice(0, idx);
			const lastNl = before.lastIndexOf('\n');
			const baseIndent = lastNl >= 0 ? (before.slice(lastNl + 1).match(/^\s*/)?.[0] ?? '') : '';
			const indent = `${baseIndent}\t`; // добавляем один таб к текущей глубине

			// Форматируем блок с переносами и отступами
			const formatted = `\n${headHtml
				.split('\n')
				.map((l) => `${indent}${l}`)
				.join('\n')}\n${baseIndent}`;
			return html.replace(marker, `${formatted}${marker}`);
		},
	};
}
