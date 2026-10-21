import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSubmittedDraft, clearSubmittedFile, interactiveOptions } from './inboxInteraction.js';
test('sending A while B is active clears only A draft', () => {
 const next = clearSubmittedDraft({ A: ' Hola ', B: 'Otro cliente' }, 'A', 'Hola');
 assert.equal(next.A, ''); assert.equal(next.B, 'Otro cliente');
});
test('a delayed response preserves a newer draft', () => {
 const drafts = { A: 'Texto nuevo' };
 assert.equal(clearSubmittedDraft(drafts, 'A', 'Texto enviado'), drafts);
});
test('same filename from a new attachment is not removed by an earlier send', () => {
 const first = { name: 'pago.pdf' }, second = { name: 'pago.pdf' };
 const files = { A: second, B: first };
 assert.equal(clearSubmittedFile(files, 'A', first), files);
 const next = clearSubmittedFile(files, 'B', first);
 assert.equal(next.A, second); assert.equal(next.B, undefined);
});
test('historical menus expose actual row titles and button replies only', () => {
 assert.deepEqual(interactiveOptions({ sections: [{ rows: [{ id: 'one', title: 'Pedido' }] }], buttons: [{ reply: { id: 'two', title: 'Ayuda' } }] }).map(row => row.title), ['Pedido', 'Ayuda']);
 assert.deepEqual(interactiveOptions({ sections: 'bad' }), []);
 assert.deepEqual(interactiveOptions({}), []);
 assert.deepEqual(interactiveOptions({ sections: [null, {}], buttons: [null, {}] }), []);
});
