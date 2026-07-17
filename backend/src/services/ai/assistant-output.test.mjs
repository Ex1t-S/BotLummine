import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeProviderOutput, validateAssistantOutput } from './assistant-output.js';

describe('assistant output schema', () => {
	it('normalizes a legacy provider text into the internal schema', () => {
		const output = normalizeProviderOutput({ text: ' Respuesta verificada. ' });
		assert.deepEqual(output, {
			reply: 'Respuesta verificada.',
			needsHuman: false,
			handoffReason: null,
			detectedIntent: 'UNKNOWN',
			confidence: 0,
			usedFacts: [],
			riskFlags: [],
		});
	});

	it('rejects empty replies and incomplete handoffs', () => {
		assert.throws(() => normalizeProviderOutput({ text: '   ' }), /Invalid output schema/);
		assert.throws(
			() => validateAssistantOutput({ reply: 'Derivo.', needsHuman: true }),
			/handoffReason is required/,
		);
	});
});
