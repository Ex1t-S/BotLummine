import crypto from 'crypto';

const PREFIX = 'enc:v1:';

function getEncryptionSecret() {
	return String(process.env.SECRET_ENCRYPTION_KEY || '').trim();
}

function deriveKey(secret) {
	return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

export function isEncryptedSecret(value = '') {
	return typeof value === 'string' && value.startsWith(PREFIX);
}

export function hasSecretEncryptionKey() {
	return Boolean(getEncryptionSecret());
}

export function validateSecretEncryptionConfig() {
	const secret = getEncryptionSecret();

	if (secret && secret.length < 64) {
		throw new Error('SECRET_ENCRYPTION_KEY debe tener al menos 64 caracteres.');
	}

	if (process.env.NODE_ENV === 'production' && !secret) {
		throw new Error('SECRET_ENCRYPTION_KEY es obligatorio en production para guardar secretos cifrados.');
	}
}

export function encryptSecret(value) {
	if (value === null || value === undefined) return value;
	const normalized = String(value);
	if (!normalized || isEncryptedSecret(normalized)) return normalized;

	const secret = getEncryptionSecret();
	if (!secret) return normalized;

	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv);
	const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();

	return [
		PREFIX.slice(0, -1),
		iv.toString('base64url'),
		tag.toString('base64url'),
		ciphertext.toString('base64url'),
	].join(':');
}

export function decryptSecret(value) {
	if (value === null || value === undefined) return value;
	const normalized = String(value);
	if (!isEncryptedSecret(normalized)) return normalized;

	const secret = getEncryptionSecret();
	if (!secret) {
		throw new Error('SECRET_ENCRYPTION_KEY es obligatorio para leer secretos cifrados.');
	}

	const parts = normalized.split(':');
	if (parts.length !== 5) {
		throw new Error('Formato de secreto cifrado invalido.');
	}

	const [, , ivRaw, tagRaw, ciphertextRaw] = parts;
	const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivRaw, 'base64url'));
	decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
	return Buffer.concat([
		decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
		decipher.final(),
	]).toString('utf8');
}
