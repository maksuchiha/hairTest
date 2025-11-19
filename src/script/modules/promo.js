export const promo = () => {
	const SELECTORS = {
		root: '.promo',
		nav: '.promo-nav',
		button: '.promo-nav-button',
		slide: '.promo-slide',
		img: '.promo__img',
	};

	const CLASSES = {
		activeButton: 'promo-nav-button_active',
		activeSlide: 'promo-slide_active',
		noTransition: 'promo-nav-button_no-transition',
		activeImage: 'promo__img_active',
	};

	const ATTRS = {
		id: 'data-promo-id',
	};

	const DATA_KEYS = {
		indexFromCenter: 'promoIndexFromCenter',
	};

	const CSS_VARS = {
		indexFromCenter: '--index-from-center',
		index: '--i',
	};

	const VISIBLE_RANGE = 2;
	const HIDDEN_POSITION = VISIBLE_RANGE + 1;
	const TELEPORT_POSITION = HIDDEN_POSITION + 1;
	const Z_INDEX_BASE = 100;
	const SIXTH_SLIDE_INDEX = 5;

	const getSign = (value) => (value === 0 ? 0 : Math.sign(value));
	const isHidden = (value) => Math.abs(value) >= HIDDEN_POSITION;
	const isEdge = (value) => Math.abs(value) === VISIBLE_RANGE;

	const initAllPromos = () => document.querySelectorAll(SELECTORS.root).forEach(initPromo);

	const bindIdsAndIndices = (buttons, slides) => {
		const slideById = new Map();

		buttons.forEach((button, index) => {
			const slide = slides[index];
			const existingId = button.getAttribute(ATTRS.id) || slide?.getAttribute(ATTRS.id);

			const id = existingId || String(index + 1);

			button.setAttribute(ATTRS.id, id);
			button.style.setProperty(CSS_VARS.index, String(index));

			if (slide) {
				slide.setAttribute(ATTRS.id, slide.getAttribute(ATTRS.id) || id);
			}

			slideById.set(id, slide || null);
		});

		return slideById;
	};

	const initPromo = (root) => {
		const nav = root.querySelector(SELECTORS.nav);
		const buttons = [...root.querySelectorAll(SELECTORS.button)];
		const slides = [...root.querySelectorAll(SELECTORS.slide)];
		const image = root.querySelector(SELECTORS.img);

		if (!nav || !buttons.length || !slides.length) return;

		const slideById = bindIdsAndIndices(buttons, slides);

		const length = buttons.length;
		const half = length / 2;

		const getPosition = (activeIndex, index) => {
			let delta = index - activeIndex;

			if (delta > half) delta -= length;
			if (delta < -half) delta += length;

			const abs = Math.abs(delta);
			if (abs <= VISIBLE_RANGE) return delta;

			return getSign(delta) * HIDDEN_POSITION;
		};

		const foundIndex = buttons.findIndex((btn) => btn.classList.contains(CLASSES.activeButton));

		let activeIndex = foundIndex >= 0 ? foundIndex : 0;

		let activeButton = buttons[activeIndex];
		let activeSlide = slideById.get(activeButton.getAttribute(ATTRS.id) || '') || null;

		const setIndex = (button, value, persist = true) => {
			const stringValue = String(value);
			button.style.setProperty(CSS_VARS.indexFromCenter, stringValue);
			button.style.zIndex = String(Z_INDEX_BASE - Math.abs(value));
			if (persist) button.dataset[DATA_KEYS.indexFromCenter] = stringValue;
		};

		const updateActiveImage = () => {
			if (!image) return;
			image.classList.toggle(CLASSES.activeImage, activeIndex === SIXTH_SLIDE_INDEX);
		};

		const updatePositions = () => {
			// from -> to, instant = без анимации (телепорт)
			const ops = [];

			const addOp = (button, from, to, instant) => {
				ops.push({ button, from, to, instant });
			};

			buttons.forEach((button, index) => {
				const rawPrev = button.dataset[DATA_KEYS.indexFromCenter];
				const hasPrev = rawPrev !== undefined;
				const prev = hasPrev ? Number(rawPrev) : 0;
				const nextBase = getPosition(activeIndex, index);

				// первый проход — просто расставляем
				if (!hasPrev) {
					setIndex(button, nextBase);
					return;
				}

				if (prev === nextBase) return;

				const prevHidden = isHidden(prev);
				const nextHidden = isHidden(nextBase);
				const prevSign = getSign(prev);
				const nextSign = getSign(nextBase);
				const signChanged = prevSign !== 0 && nextSign !== 0 && prevSign !== nextSign;

				const prevVisible = !prevHidden;
				const nextVisible = !nextHidden;

				const teleportIndex = (sign) => sign * TELEPORT_POSITION;

				const edgeToEdge = prevVisible && nextVisible && signChanged && isEdge(prev) && isEdge(nextBase);

				if (edgeToEdge) {
					addOp(button, teleportIndex(nextSign), nextBase, false);
					return;
				}

				if (prevVisible && nextHidden) {
					if (signChanged) {
						addOp(button, prev, getSign(prev) * HIDDEN_POSITION, false);
					} else {
						addOp(button, prev, nextBase, false);
					}
					return;
				}

				if (prevHidden && nextVisible) {
					if (signChanged) {
						// тут тоже телепортируем в реально скрытую точку новой стороны
						addOp(button, teleportIndex(nextSign), nextBase, false);
					} else {
						addOp(button, prev, nextBase, false);
					}
					return;
				}

				if (prevHidden && nextHidden) {
					addOp(button, nextBase, nextBase, true);
					return;
				}

				addOp(button, prev, nextBase, false);
			});

			if (!ops.length) return;

			buttons.forEach((button) => {
				button.classList.add(CLASSES.noTransition);
			});

			ops.forEach(({ button, from, to, instant }) => {
				if (instant) {
					setIndex(button, to);
				} else {
					setIndex(button, from, false);
				}
			});

			void nav.offsetWidth;

			buttons.forEach((button) => {
				button.classList.remove(CLASSES.noTransition);
			});

			ops.forEach(({ button, to, instant }) => {
				if (instant) return;
				setIndex(button, to);
			});
		};

		const setActiveButton = (next) => {
			if (activeButton === next) return;
			activeButton?.classList.remove(CLASSES.activeButton);
			next.classList.add(CLASSES.activeButton);
			activeButton = next;
		};

		const setActiveSlide = (id) => {
			const next = id ? slideById.get(id) : null;
			if (!next || next === activeSlide) return;
			activeSlide?.classList.remove(CLASSES.activeSlide);
			next.classList.add(CLASSES.activeSlide);
			activeSlide = next;
		};

		const setActiveIndex = (index) => {
			if (index === activeIndex || index < 0 || index >= length) return;

			activeIndex = index;
			const button = buttons[index];

			setActiveButton(button);
			setActiveSlide(button.getAttribute(ATTRS.id));
			updatePositions();
			updateActiveImage();
		};

		updatePositions();
		setActiveButton(activeButton);
		setActiveSlide(activeButton.getAttribute(ATTRS.id));
		updateActiveImage();

		nav.addEventListener('click', (event) => {
			const button = event.target.closest(SELECTORS.button);
			if (!button || !nav.contains(button)) return;

			const index = buttons.indexOf(button);
			if (index === -1) return;

			setActiveIndex(index);
		});
	};

	initAllPromos();
};
