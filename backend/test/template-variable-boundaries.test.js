import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateTemplateBodyBoundaries } from '../../frontend/src/features/campaigns/templateVariables.js';
import { classifyWhatsAppError } from '../src/lib/whatsapp-error-classifier.js';

describe('template body variable boundaries', () => {
	it('identifies dangling positional and named parameters before submitting to Meta', () => {
		for (const body of ['Hola, retomá tu compra en {{2}}', '  {{1}} te esperamos. ', 'Hola {{nombre}}, comprá en {{enlace}}\n', '{{nombre}} te esperamos.']) {
			assert.match(validateTemplateBodyBoundaries(body), /texto fijo/);
		}
	});
	it('allows personalized names and checkout links surrounded by fixed text, and plain templates', () => {
		for (const body of ['Hola {{1}}, retomá tu compra en {{2}}. Si necesitás ayuda, respondé este mensaje.', 'Hola {{nombre}}, retomá tu compra en {{enlace}}. Te ayudamos por acá.', 'Hola, te esperamos en nuestra tienda.']) {
			assert.equal(validateTemplateBodyBoundaries(body), '');
		}
	});
	it('explains the actual Meta rejection without telling the merchant to remove variables', () => {
		const error = classifyWhatsAppError({ metaCode: 100, metaSubcode: 2388299, message: 'Invalid parameter' }, 'template');
		assert.match(error.title, /empieza o termina/);
		assert.match(error.action, /conservar/);
		assert.equal(error.subcode, 2388299);
	});
});
