#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const budgetPath = path.join(rootDir, 'docs', 'perf-budget.json');
const assetsDir = path.join(rootDir, 'dist', 'assets');

if (!fs.existsSync(budgetPath)) {
  console.error('[perf-budget] Missing docs/perf-budget.json');
  process.exit(1);
}

if (!fs.existsSync(assetsDir)) {
  console.error('[perf-budget] Missing dist/assets. Run npm run build first.');
  process.exit(1);
}

const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
const baselineBundleBytes = Number(budget.baselineBundleBytes);
const allowedRegressionPercent = Number(budget.allowedRegressionPercent ?? 5);
const targetReductionPercent = Number(budget.targetReductionPercent ?? 20);

if (!Number.isFinite(baselineBundleBytes) || baselineBundleBytes <= 0) {
  console.error('[perf-budget] Invalid baselineBundleBytes');
  process.exit(1);
}

const jsFiles = fs
  .readdirSync(assetsDir)
  .filter((file) => file.endsWith('.js'))
  .map((file) => {
    const fullPath = path.join(assetsDir, file);
    return { file, bytes: fs.statSync(fullPath).size };
  })
  .sort((a, b) => b.bytes - a.bytes);

if (jsFiles.length === 0) {
  console.error('[perf-budget] No JS files found in dist/assets');
  process.exit(1);
}

const largest = jsFiles[0];
const maxAllowedBytes = Math.round(baselineBundleBytes * (1 + allowedRegressionPercent / 100));
const targetBytes = Math.round(baselineBundleBytes * (1 - targetReductionPercent / 100));

const reductionPercent = ((baselineBundleBytes - largest.bytes) / baselineBundleBytes) * 100;
const snapshot = {
  file: largest.file,
  bundleBytes: largest.bytes,
  baselineBundleBytes,
  maxAllowedBytes,
  targetBytes,
  reductionPercent: Number(reductionPercent.toFixed(2)),
};

console.log('[perf-budget] Snapshot:', JSON.stringify(snapshot));

if (largest.bytes > maxAllowedBytes) {
  console.error(
    `[perf-budget] FAIL: ${largest.bytes} bytes exceeds regression guardrail (${maxAllowedBytes}).`
  );
  process.exit(1);
}

if (largest.bytes <= targetBytes) {
  console.log('[perf-budget] PASS: target reduction reached.');
  process.exit(0);
}

console.log('[perf-budget] PASS: no regression against baseline guardrail.');
