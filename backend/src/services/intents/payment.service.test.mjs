import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyPaymentQuestion, resolveTransferDetails } from './payment.service.js';

describe('workspace payment configuration', () => {
	it('classifies CVU and CUIT as transfer questions', () => {
		assert.equal(classifyPaymentQuestion('Me pasás el CVU?'), 'transfer');
		assert.equal(classifyPaymentQuestion('Cuál es el CUIT del titular?'), 'transfer');
	});

	it('supports Argentina payment fields without reading global environment defaults', () => {
		assert.deepEqual(
			resolveTransferDetails({ alias: ' tienda.ok ', cvu: '000123', holder: 'Tienda', cuit: '20-123' }),
			{
				alias: 'tienda.ok',
				cbu: null,
				cvu: '000123',
				holder: 'Tienda',
				cuit: '20-123',
				bank: null,
				extra: null,
			}
		);
	});

	it('does not invent a transfer account when workspace data is empty', () => {
		assert.deepEqual(resolveTransferDetails(), {
			alias: null,
			cbu: null,
			cvu: null,
			holder: null,
			cuit: null,
			bank: null,
			extra: null,
		});
	});
});
