import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectIntent } from './intent.js';

describe('commercial intent detection', () => {
	it('recognizes price questions as product intent', () => {
		assert.equal(detectIntent('cuanto sale la calza'), 'product');
		assert.equal(detectIntent('cual es el precio'), 'product');
	});

	it('recognizes a direct buying request without prior state', () => {
		assert.equal(detectIntent('quiero comprar'), 'product');
		assert.equal(detectIntent('quiero comprar la calza'), 'product');
	});

	it('preserves post-sale intent over commercial keywords', () => {
		assert.equal(detectIntent('quiero saber donde esta mi pedido'), 'order_status');
		assert.equal(detectIntent('quiero hacer un cambio'), 'return_exchange');
	});

	it('does not classify campaign opt-outs as purchase intent', () => {
		assert.equal(detectIntent('No me interesa, denme de baja'), 'general');
		assert.equal(detectIntent('No me escriban más por este carrito'), 'general');
	});
});
