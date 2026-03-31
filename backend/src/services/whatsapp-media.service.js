import fs from 'node:fs';
import FormData from 'form-data';
import axios from 'axios';

function readRequiredEnv(name) {
	const value = String(process.env[name] || '').trim();
	if (!value) {
		throw new Error(`Falta la variable de entorno ${name}`);
	}
	return value;
}

function getGraphApiVersion() {
	return String(process.env.WHATSAPP_GRAPH_VERSION || 'v25.0').trim();
}

function getPhoneNumberId() {
	return readRequiredEnv('WHATSAPP_PHONE_NUMBER_ID');
}

function getAccessToken() {
	return readRequiredEnv('WHATSAPP_ACCESS_TOKEN');
}

export async function uploadWhatsAppMedia({ filePath, mimeType }) {
	if (!filePath) {
		throw new Error('filePath es obligatorio para subir media a Meta.');
	}

	const phoneNumberId = getPhoneNumberId();
	const graphVersion = getGraphApiVersion();
	const accessToken = getAccessToken();

	const form = new FormData();
	form.append('messaging_product', 'whatsapp');
	form.append('file', fs.createReadStream(filePath), {
		contentType: mimeType || 'image/png'
	});

	const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/media`;

	try {
		const response = await axios.post(url, form, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				...form.getHeaders()
			},
			maxBodyLength: Infinity,
			maxContentLength: Infinity
		});

		return {
			ok: true,
			mediaId: response?.data?.id || null,
			rawPayload: response?.data || null
		};
	} catch (error) {
		return {
			ok: false,
			error: error?.response?.data || {
				message: error.message
			}
		};
	}
}