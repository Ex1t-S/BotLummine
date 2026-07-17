import fs from 'node:fs/promises';
import { detectIntent } from '../src/lib/intent.js';

const corpusUrl = new URL('../evals/agent-eval-corpus.json', import.meta.url);
const corpus = JSON.parse(await fs.readFile(corpusUrl, 'utf8'));
const cases = Array.isArray(corpus?.cases) ? corpus.cases : [];
const seenIds = new Set();

for (const testCase of cases) {
	if (!testCase?.id || seenIds.has(testCase.id)) {
		throw new Error(`ID de evaluación ausente o duplicado: ${testCase?.id || '(vacío)'}`);
	}
	seenIds.add(testCase.id);
}

const intentCases = cases.filter((testCase) => testCase.mode === 'intent');
const candidateCases = cases.filter((testCase) => testCase.mode === 'candidate');
const results = intentCases.map((testCase) => {
	const actualIntent = detectIntent(testCase.input, testCase.state || {}, testCase.options || {});
	return {
		id: testCase.id,
		category: testCase.category,
		expectedIntent: testCase.expectedIntent,
		actualIntent,
		pass: actualIntent === testCase.expectedIntent,
	};
});

const categoryMetrics = Object.values(results.reduce((groups, result) => {
	const group = groups[result.category] || { category: result.category, passed: 0, total: 0 };
	group.total += 1;
	if (result.pass) group.passed += 1;
	groups[result.category] = group;
	return groups;
}, {})).map((group) => ({
	...group,
	accuracy: group.total ? Number((group.passed / group.total).toFixed(4)) : 0,
}));

const passed = results.filter((result) => result.pass).length;
const report = {
	corpusVersion: corpus.version,
	totalCases: cases.length,
	executedOffline: intentCases.length,
	pendingSandboxCandidateCases: candidateCases.length,
	intentAccuracy: intentCases.length ? Number((passed / intentCases.length).toFixed(4)) : 0,
	categoryMetrics,
	failures: results.filter((result) => !result.pass),
	pendingCandidateCaseIds: candidateCases.map((testCase) => testCase.id),
};

console.log(JSON.stringify(report, null, 2));

if (report.failures.length) {
	process.exitCode = 1;
}
