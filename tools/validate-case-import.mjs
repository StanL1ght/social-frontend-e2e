import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node tools/validate-case-import.mjs <json-file>');

const data = JSON.parse(readFileSync(file, 'utf8'));
const reference = JSON.parse(readFileSync('artifacts/Уведомления, заявки, опросы и роли — для импорта с пометками.json', 'utf8'));
const requiredRoot = ['schema_version', 'project', 'selection', 'summary', 'suites'];
const requiredSuite = ['id', 'title', 'path', 'position', 'test_cases', 'suites'];
const referenceCases = reference.suites.flatMap((suite) => suite.test_cases);
const requiredCase = Object.keys(referenceCases[0]).filter((key) => referenceCases.every((testCase) => key in testCase));

function requireKeys(value, keys, label) {
  for (const key of keys) {
    if (!(key in value)) throw new Error(`${label}: missing ${key}`);
  }
}

requireKeys(data, requiredRoot, 'root');
if (!Array.isArray(data.suites) || data.suites.length === 0) throw new Error('No suites');
const cases = [];
for (const suite of data.suites) {
  requireKeys(suite, requiredSuite, `suite ${suite.title ?? '?'}`);
  if (!Array.isArray(suite.test_cases)) throw new Error(`Invalid test_cases in ${suite.title}`);
  for (const testCase of suite.test_cases) {
    requireKeys(testCase, requiredCase, `case ${testCase.title ?? '?'}`);
    if ('id' in testCase || 'key' in testCase) throw new Error(`New import case retains id/key: ${testCase.title}`);
    if (!Array.isArray(testCase.steps) || testCase.steps.length === 0) throw new Error(`No steps: ${testCase.title}`);
    for (const [index, step] of testCase.steps.entries()) {
      requireKeys(step, ['position', 'action', 'expected_result'], `step ${index + 1}`);
      if (step.position !== index + 1) throw new Error(`Wrong step position in ${testCase.title}`);
    }
    cases.push(testCase);
  }
}
const steps = cases.reduce((sum, testCase) => sum + testCase.steps.length, 0);
if (data.summary.suite_count !== data.suites.length || data.summary.test_case_count !== cases.length || data.summary.step_count !== steps) {
  throw new Error('Summary counts do not match contents');
}
console.log(`Structurally valid: ${data.suites.length} suite(s), ${cases.length} case(s), ${steps} step(s). Import not confirmed.`);
