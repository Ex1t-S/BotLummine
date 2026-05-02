import crypto from 'node:crypto';

export function attachRequestId(req, res, next) {
	const incoming =
		req.headers['x-request-id'] ||
		req.headers['x-correlation-id'] ||
		null;
	const requestId = String(incoming || crypto.randomUUID()).trim();

	req.requestId = requestId;
	res.setHeader('X-Request-Id', requestId);

	return next();
}
