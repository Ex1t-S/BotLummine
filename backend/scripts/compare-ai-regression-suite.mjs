import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_DIR = path.resolve(BACKEND_DIR, '..');
const TEMP_DIR = path.join(BACKEND_DIR, '.ai-regression-head');

function parseArgs(argv = []) {
	const options = {
		baseline: 'head',
		workspace: process.env.AI_REGRESSION_WORKSPACE_ID || 'workspace_lummine',
		keepTemp: false,
		scenarios: [],
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--keep-temp') {
			options.keepTemp = true;
		} else if (arg === '--baseline') {
			options.baseline = argv[index + 1] || options.baseline;
			index += 1;
		} else if (arg.startsWith('--baseline=')) {
			options.baseline = arg.slice('--baseline='.length) || options.baseline;
		} else if (arg === '--workspace') {
			options.workspace = argv[index + 1] || options.workspace;
			index += 1;
		} else if (arg.startsWith('--workspace=')) {
			options.workspace = arg.slice('--workspace='.length) || options.workspace;
		} else if (!arg.startsWith('--')) {
			options.scenarios.push(arg);
		}
	}

	return options;
}

function runProcess(command, args = [], { cwd = REPO_DIR, env = process.env, allowFailure = false } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env,
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const stdout = [];
		const stderr = [];

		child.stdout.on('data', (chunk) => stdout.push(chunk));
		child.stderr.on('data', (chunk) => stderr.push(chunk));
		child.on('error', reject);
		child.on('close', (code) => {
			const result = {
				code,
				stdout: Buffer.concat(stdout),
				stderr: Buffer.concat(stderr),
			};

			if (code !== 0 && !allowFailure) {
				const error = new Error(`${command} ${args.join(' ')} failed with exit code ${code}`);
				error.result = result;
				reject(error);
				return;
			}

			resolve(result);
		});
	});
}

async function captureText(command, args = [], options = {}) {
	const result = await runProcess(command, args, options);
	return result.stdout.toString('utf8');
}

async function captureBuffer(command, args = [], options = {}) {
	const result = await runProcess(command, args, options);
	return result.stdout;
}

async function copyHeadBackend() {
	await rm(TEMP_DIR, { recursive: true, force: true });
	await mkdir(TEMP_DIR, { recursive: true });

	const pathsText = await captureText('git', [
		'ls-tree',
		'-r',
		'--name-only',
		'HEAD',
		'--',
		'backend/src',
		'backend/prisma/schema.prisma',
		'backend/package.json',
	], { cwd: REPO_DIR });

	const paths = pathsText
		.split(/\r?\n/)
		.map((item) => item.trim())
		.filter((item) => item.startsWith('backend/'));

	for (const repoPath of paths) {
		const relativePath = repoPath.slice('backend/'.length);
		const targetPath = path.join(TEMP_DIR, relativePath);
		const content = await captureBuffer('git', ['show', `HEAD:${repoPath}`], { cwd: REPO_DIR });
		await mkdir(path.dirname(targetPath), { recursive: true });
		await writeFile(targetPath, content);
	}

	// Use the current fixtures/runner so both versions are evaluated with the same scenarios.
	const overlayFiles = [
		'scripts/run-ai-regression-suite.mjs',
		'src/data/ai-lab-fixtures.js',
		'src/services/ai/ai-lab.service.js',
	];

	for (const relativePath of overlayFiles) {
		const sourcePath = path.join(BACKEND_DIR, relativePath);
		const targetPath = path.join(TEMP_DIR, relativePath);
		await mkdir(path.dirname(targetPath), { recursive: true });
		await copyFile(sourcePath, targetPath);
	}
}

function parseJsonOutput(output = '') {
	const text = String(output || '').trim();
	const candidates = [];

	for (let index = text.length - 1; index >= 0; index -= 1) {
		if (text[index] === '{') candidates.push(index);
	}

	for (const index of candidates) {
		try {
			return JSON.parse(text.slice(index));
		} catch {
			// Try the previous opening brace.
		}
	}

	throw new Error('No se pudo parsear JSON de la suite de regresion.');
}

async function runSuite({ label, scriptPath, workspace, scenarios }) {
	const result = await runProcess(
		process.execPath,
		[scriptPath, ...scenarios],
		{
			cwd: BACKEND_DIR,
			env: {
				...process.env,
				AI_REGRESSION_WORKSPACE_ID: workspace,
				AI_REGRESSION_LABEL: label,
			},
			allowFailure: true,
		}
	);

	const stdout = result.stdout.toString('utf8');
	const stderr = result.stderr.toString('utf8');
	return {
		label,
		code: result.code,
		stdout,
		stderr,
		json: parseJsonOutput(stdout),
	};
}

function failedChecks(result = {}) {
	return (result.results || [])
		.filter((check) => !check.pass)
		.map((check) => check.check);
}

function shortReply(value = '') {
	const text = String(value || '').replace(/\s+/g, ' ').trim();
	return text.length > 320 ? `${text.slice(0, 317)}...` : text;
}

function compareRuns({ baseline, current }) {
	const baselineByKey = new Map((baseline.json.results || []).map((result) => [result.key || result.fixtureKey, result]));
	const currentResults = current.json.results || [];

	const scenarios = currentResults.map((currentResult) => {
		const key = currentResult.key || currentResult.fixtureKey;
		const baselineResult = baselineByKey.get(key) || null;
		let status = 'unchanged';

		if (!baselineResult) {
			status = 'new';
		} else if (!baselineResult.pass && currentResult.pass) {
			status = 'improved';
		} else if (baselineResult.pass && !currentResult.pass) {
			status = 'regression';
		} else if (!baselineResult.pass && !currentResult.pass) {
			status = 'still_failing';
		}

		return {
			key,
			fixtureKey: currentResult.fixtureKey,
			status,
			baselinePass: baselineResult?.pass ?? null,
			currentPass: currentResult.pass,
			baselineFailedChecks: baselineResult ? failedChecks(baselineResult) : [],
			currentFailedChecks: failedChecks(currentResult),
			baselineReply: shortReply(baselineResult?.reply || ''),
			currentReply: shortReply(currentResult.reply || ''),
			currentTrace: {
				provider: currentResult.provider || '',
				model: currentResult.model || '',
				intent: currentResult.intent || '',
				action: currentResult.action || '',
			},
		};
	});

	return {
		baseline: {
			label: baseline.label,
			code: baseline.code,
			total: baseline.json.total,
			passed: baseline.json.passed,
			failed: baseline.json.failed,
		},
		current: {
			label: current.label,
			code: current.code,
			total: current.json.total,
			passed: current.json.passed,
			failed: current.json.failed,
		},
		summary: {
			improved: scenarios.filter((scenario) => scenario.status === 'improved').length,
			regressions: scenarios.filter((scenario) => scenario.status === 'regression').length,
			stillFailing: scenarios.filter((scenario) => scenario.status === 'still_failing').length,
			unchanged: scenarios.filter((scenario) => scenario.status === 'unchanged').length,
			new: scenarios.filter((scenario) => scenario.status === 'new').length,
		},
		scenarios,
	};
}

const options = parseArgs(process.argv.slice(2));

if (options.baseline !== 'head') {
	throw new Error('Por ahora el comparador solo soporta --baseline=head.');
}

try {
	await copyHeadBackend();

	const baselineScript = path.join(TEMP_DIR, 'scripts', 'run-ai-regression-suite.mjs');
	const currentScript = path.join(BACKEND_DIR, 'scripts', 'run-ai-regression-suite.mjs');

	const baseline = await runSuite({
		label: 'git-head',
		scriptPath: baselineScript,
		workspace: options.workspace,
		scenarios: options.scenarios,
	});

	const current = await runSuite({
		label: 'working-tree',
		scriptPath: currentScript,
		workspace: options.workspace,
		scenarios: options.scenarios,
	});

	const comparison = compareRuns({ baseline, current });
	console.log(JSON.stringify({
		workspaceId: options.workspace,
		baseline: options.baseline,
		provider: process.env.AI_PROVIDER || 'gemini',
		geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
		...comparison,
	}, null, 2));

	process.exitCode =
		comparison.summary.regressions > 0 || comparison.current.failed > 0
			? 1
			: 0;
} finally {
	if (!options.keepTemp) {
		await rm(TEMP_DIR, { recursive: true, force: true });
	}
}
