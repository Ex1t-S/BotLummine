import { lazy } from 'react';

function wait(ms) {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}

export function lazyWithRetry(importer, label = 'lazy-module') {
	return lazy(async () => {
		try {
			return await importer();
		} catch (firstError) {
			console.error('[APP][LAZY_IMPORT_RETRY]', {
				label,
				error: firstError,
				path: typeof window !== 'undefined' ? window.location.pathname : '',
			});

			await wait(350);

			try {
				return await importer();
			} catch (secondError) {
				console.error('[APP][LAZY_IMPORT_FAILED]', {
					label,
					error: secondError,
					path: typeof window !== 'undefined' ? window.location.pathname : '',
				});
				throw secondError;
			}
		}
	});
}
