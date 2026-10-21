// Clear only the submitted value; preserve newer edits and other conversations.
export function clearSubmittedDraft(drafts, conversationId, body) {
  if ((drafts[conversationId] || '').trim() !== body) return drafts;
  return { ...drafts, [conversationId]: '' };
}
export function clearSubmittedFile(files, conversationId, file) {
  if (files[conversationId] !== file) return files;
  const next = { ...files };
  delete next[conversationId];
  return next;
}
export function interactiveOptions(payload = {}) {
  const rows = (Array.isArray(payload.sections) ? payload.sections : []).flatMap(section => Array.isArray(section?.rows) ? section.rows : []);
  const buttons = Array.isArray(payload.buttons) ? payload.buttons.map(button => button?.reply || button) : [];
  return [...rows, ...buttons].filter(option => typeof option?.title === 'string');
}
