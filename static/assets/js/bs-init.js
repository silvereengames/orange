
(function() {

	const loadStart = Date.now();
	const preloaders = document.querySelectorAll(".preloader");

	const prevOverflow = document.body.style.overflow;
	let scrollbarWidth = 0;
	let activePreloaders = preloaders.length;
	let preloaderShown = false;
	const removedPreloaders = new Set();

	// Storage access throws when the browser blocks site data. Show the preloader in that case.
	try {
		preloaderShown = !!sessionStorage.getItem("preloader-shown");

		if (preloaders.length) {
			sessionStorage.setItem("preloader-shown", "1");
		}
	} catch (e) {}

	if (preloaders.length && !preloaderShown) {
		disableOverflow();
	} else {
		for (const preloader of preloaders) {
			hidePreloader(preloader);
		}
		activePreloaders = 0;
	}

	function disableOverflow() {
		scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
		document.body.style.overflow = "hidden";

		if (scrollbarWidth > 0) {
			document.body.style.paddingRight = (parseFloat(getComputedStyle(document.body).paddingRight) + scrollbarWidth) + "px";
		}
	}

	function restoreOverflow() {
		activePreloaders--;
		if (activePreloaders > 0) return;

		document.body.style.overflow = prevOverflow;
		if (scrollbarWidth > 0) {
			const currentPadding = parseFloat(getComputedStyle(document.body).paddingRight);
			document.body.style.paddingRight = Math.max(currentPadding - scrollbarWidth, 0) + "px";
		}
	}

	function hidePreloader(preloader) {
		preloader.classList.remove("preloader-show");
	}

	function removePreloader(preloader) {
		// Both the min and max duration timeouts may call this
		if (removedPreloaders.has(preloader)) return;
		removedPreloaders.add(preloader);

		const animationName = preloader.dataset.preloaderExitAnimation;

		function onDone() {
			hidePreloader(preloader);
			restoreOverflow();
		}

		if (animationName) {
			animateCSS(preloader, animationName, onDone);
		}
		else {
			onDone();
		}
	}

	function animateCSS(node, animationName, callback) {
		// Finish anyway if animationend never fires, e.g. animate.css failed to load
		// or the preloader is hidden with d-none
		const fallback = setTimeout(finish, 3000);

		function handleAnimationEnd(e) {
			// Ignore animations of child elements
			if (e.target === node) finish();
		}

		function finish() {
			clearTimeout(fallback);
			node.classList.remove('animated', animationName);
			node.removeEventListener('animationend', handleAnimationEnd);

			if (typeof callback === 'function') callback();
		}

		node.classList.add('animated', animationName);
		node.addEventListener('animationend', handleAnimationEnd);
	}

	if (activePreloaders > 0) {
		// Hide after the max duration, even if the page is still loading
		for (const preloader of preloaders) {
			const maxDuration = parseInt(preloader.getAttribute("data-preloader-max-duration"), 10);

			if (!isNaN(maxDuration)) {
				setTimeout(() => {
					removePreloader(preloader);
				}, Math.max(maxDuration, 0));
			}
		}

		function onLoad() {
			const loadDuration = Date.now() - loadStart;

			for (const preloader of preloaders) {
				let minDuration = parseInt(preloader.getAttribute("data-preloader-min-duration"), 10);
				minDuration = isNaN(minDuration) ? 1200 : minDuration;

				setTimeout(() => {
					removePreloader(preloader);
				}, Math.max(minDuration - loadDuration, 0));
			}
		}

		if (document.readyState === "complete") {
			onLoad();
		} else {
			window.addEventListener("load", onLoad);
		}
	}

})();

document.addEventListener('DOMContentLoaded', function() {
}, false);