#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const oldPath = 'artifacts/Все кейсы — точечная актуализация.json';
const newPath = process.argv[2];
if (!newPath) throw new Error('Usage: node tools/audit-new-case-export.mjs <export.json>');

const oldData = JSON.parse(readFileSync(oldPath, 'utf8'));
const newData = JSON.parse(readFileSync(newPath, 'utf8'));
const flatten = (suites, parent = []) => suites.flatMap((suite) => {
  const path = [...parent, suite.title];
  return [
    ...suite.test_cases.map((testCase) => ({ ...testCase, suitePath: path })),
    ...flatten(suite.suites ?? [], path),
  ];
});
const oldCases = flatten(oldData.suites);
const newCases = flatten(newData.suites);
const oldByKey = new Map(oldCases.filter((item) => item.key).map((item) => [item.key, item]));
const newByKey = new Map(newCases.map((item) => [item.key, item]));
if (newByKey.size !== newCases.length) throw new Error('New export has duplicate or missing keys');

const comparable = (item) => {
  const { suitePath, position, ...rest } = item;
  return JSON.stringify(rest);
};
const added = newCases.filter((item) => !oldByKey.has(item.key));
const existing = newCases.filter((item) => oldByKey.has(item.key));
const changed = existing.filter((item) => comparable(item) !== comparable(oldByKey.get(item.key)));
const stepChanged = existing.filter((item) => JSON.stringify(item.steps ?? []) !== JSON.stringify(oldByKey.get(item.key).steps ?? []));
const moved = existing.filter((item) => item.suitePath.join(' / ') !== oldByKey.get(item.key).suitePath.join(' / '));
const missing = oldCases.filter((item) => item.key && !newByKey.has(item.key));
const isRelevant = (item) => item.status !== 'deprecated' && item.suitePath[0] !== 'Устаревшее';
const active = newCases.filter(isRelevant);
const addedActive = added.filter(isRelevant);
const compact = (item) => ({
  key: item.key,
  id: item.id,
  title: item.title,
  status: item.status,
  suite: item.suitePath.join(' / '),
  steps: item.steps?.length ?? 0,
});
const testFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? testFiles(path) : path.endsWith('.spec.ts') ? [path] : [];
});
const sources = testFiles('tests').map((path) => ({ path, content: readFileSync(path, 'utf8') }));
const evidence = (key) => sources.filter(({ content }) => new RegExp(`\\b${key}\\b`).test(content)).map(({ path }) => path);
const bySuite = [...new Set(newCases.map((item) => item.suitePath.join(' / ')))].map((suite) => ({
  suite,
  total: newCases.filter((item) => item.suitePath.join(' / ') === suite).length,
  added: added.filter((item) => item.suitePath.join(' / ') === suite).length,
  addedActive: addedActive.filter((item) => item.suitePath.join(' / ') === suite).length,
}));
const report = {
  source: basename(newPath),
  exportedAt: newData.exported_at,
  counts: {
    oldEntries: oldCases.length,
    newEntries: newCases.length,
    relevantEntries: active.length,
    excludedEntries: newCases.length - active.length,
    deprecatedByStatus: newCases.filter((item) => item.status === 'deprecated').length,
    archivedSuiteEntries: newCases.filter((item) => item.suitePath[0] === 'Устаревшее').length,
    added: added.length,
    addedActive: addedActive.length,
    existing: existing.length,
    changed: changed.length,
    stepChanged: stepChanged.filter(isRelevant).length,
    moved: moved.length,
    missingFromNewExport: missing.length,
  },
  bySuite,
  added: added.map(compact),
  changed: changed.map(compact),
  stepChanged: stepChanged.filter(isRelevant).map(compact),
  relevantCases: active.map((item) => ({ ...compact(item), testFiles: evidence(item.key) })),
  moved: moved.map(compact),
  missing: missing.map(compact),
};
writeFileSync('artifacts/new-export-audit-2026-09-29.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.counts));
