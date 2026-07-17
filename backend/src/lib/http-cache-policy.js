export const PRIVATE_MEDIA_CACHE_CONTROL = 'private, no-store';

export function applyPrivateMediaCachePolicy(response) {
	if (!response?.setHeader) {
		throw new TypeError('An HTTP response with setHeader is required');
	}

	response.setHeader('Cache-Control', PRIVATE_MEDIA_CACHE_CONTROL);
	response.setHeader('Pragma', 'no-cache');
	response.setHeader('Expires', '0');
	response.setHeader('X-Content-Type-Options', 'nosniff');
}
