export function getHttpTimeoutMs(envName, fallbackMs = 15000) {
	const value = Number(process.env[envName] || fallbackMs);
	return Math.max(1000, Math.min(Number.isFinite(value) ? value : fallbackMs, 120000));
}

export function createAbortSignal(timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	if (typeof timer.unref === 'function') {
		timer.unref();
	}

	return {
		signal: controller.signal,
		clear: () => clearTimeout(timer),
	};
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
	const { signal, clear } = createAbortSignal(timeoutMs);

	try {
		return await fetch(url, {
			...options,
			signal: options.signal || signal,
		});
	} finally {
		clear();
	}
}

export async function withTimeout(promise, timeoutMs = 15000, message = 'Operation timed out') {
	let timer = null;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), timeoutMs);
		if (typeof timer.unref === 'function') {
			timer.unref();
		}
	});

	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timer);
	}
}
