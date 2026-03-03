#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const readArg = (name, fallback = '') => {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
};

const internalPath = readArg('--internal', '');
const externalPath = readArg('--external', '');
const thresholdPct = Number(readArg('--threshold', '3'));

if (!internalPath || !externalPath) {
  console.error('[drift] Usage: node scripts/audit-analytics-drift.mjs --internal <json> --external <json> [--threshold 3]');
  process.exit(1);
}

const readJson = (file) => {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
};

const events = ['batch_started', 'job_completed', 'job_failed', 'first_value_action'];
const internal = readJson(internalPath);
const external = readJson(externalPath);

let hasFailure = false;
for (const eventName of events) {
  const i = Number(internal[eventName] || 0);
  const e = Number(external[eventName] || 0);
  const baseline = Math.max(i, 1);
  const driftPct = Math.abs(i - e) / baseline * 100;
  const ok = driftPct < thresholdPct;
  console.log(`[drift] ${eventName}: internal=${i} external=${e} drift=${driftPct.toFixed(2)}% ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) hasFailure = true;
}

if (hasFailure) {
  console.error(`[drift] Drift exceeded threshold (${thresholdPct}%).`);
  process.exit(2);
}

console.log('[drift] All monitored events within threshold.');

