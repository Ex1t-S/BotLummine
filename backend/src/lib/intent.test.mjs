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

	it('recognizes CVU questions as payment intent', () => {
		assert.equal(detectIntent('pasame el CVU para transferir'), 'payment');
	});

	it('preserves post-sale intent over commercial keywords', () => {
		assert.equal(detectIntent('quiero saber donde esta mi pedido'), 'order_status');
		assert.equal(detectIntent('quiero hacer un cambio'), 'return_exchange');
		assert.equal(detectIntent('puedo cambiarlo si no me queda?'), 'return_exchange');
		assert.equal(detectIntent('si no me queda, puedo devolverlo?'), 'return_exchange');
		assert.equal(detectIntent('me queda grande, puedo cambiarlo?'), 'return_exchange');
	});

	it('keeps ordinary availability questions as stock checks', () => {
		assert.equal(detectIntent('me queda en negro?'), 'stock_check');
		assert.equal(detectIntent('hay stock disponible?'), 'stock_check');
	});

	it('does not classify campaign opt-outs as purchase intent', () => {
		assert.equal(detectIntent('No me interesa, denme de baja'), 'general');
		assert.equal(detectIntent('No me escriban más por este carrito'), 'general');
	});

	it('recognizes CVU and CUIT questions as payment intent', () => {
		assert.equal(detectIntent('me pasas el CVU para transferir?'), 'payment');
		assert.equal(detectIntent('necesito el CUIT del titular'), 'payment');
	});
});
