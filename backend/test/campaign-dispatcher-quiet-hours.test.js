import test from 'node:test';
import assert from 'node:assert/strict';
import { isAutomationDispatchPaused } from '../src/services/campaigns/campaign-dispatcher.service.js';

function atBuenosAires(hour) {
	return new Date(`2026-09-01T${String(hour).padStart(2, '0')}:00:00-03:00`);
}

test('pausa automatizaciones entre las 21:00 y las 09:00 ART', () => {
	assert.equal(isAutomationDispatchPaused(atBuenosAires(20)), false);
	assert.equal(isAutomationDispatchPaused(atBuenosAires(21)), true);
	assert.equal(isAutomationDispatchPaused(atBuenosAires(23)), true);
	assert.equal(isAutomationDispatchPaused(atBuenosAires(8)), true);
	assert.equal(isAutomationDispatchPaused(atBuenosAires(9)), false);
});
