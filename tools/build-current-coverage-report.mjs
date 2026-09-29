#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const source = JSON.parse(readFileSync('artifacts/coverage-matrix.json', 'utf8'));
const automated = new Set([
  'ESN-68', 'ESN-336', 'ESN-102', 'ESN-350', 'ESN-123', 'ESN-124',
  'ESN-130', 'ESN-132', 'ESN-136', 'ESN-139', 'ESN-149', 'ESN-162',
  'ESN-175', 'ESN-184', 'ESN-385', 'ESN-389', 'ESN-394', 'ESN-395',
  'ESN-398', 'ESN-403', 'UNKEYED-03', 'UNKEYED-04',
]);
const partial = new Set(['ESN-143', 'ESN-221', 'ESN-422']);
const knownDefect = new Set([
  'ESN-335', 'UNKEYED-01', 'ESN-121', 'ESN-176',
  'ESN-332', 'ESN-409', 'ESN-416', 'ESN-423',
]);
const preparationNeeded = new Set([
  'ESN-83', 'ESN-322', 'ESN-351', 'ESN-352', 'ESN-323',
  'ESN-324', 'ESN-325', 'ESN-191', 'UNKEYED-02', 'ESN-406',
]);
const clarifyRequirement = new Set(['ESN-158', 'ESN-428']);
const obsolete = new Set(['ESN-310']);
const changed = new Set([
  ...automated, ...partial, ...knownDefect, ...preparationNeeded,
  ...clarifyRequirement, ...obsolete,
]);
if (changed.size !== 46) throw new Error(`Expected 46 reconciled cases, got ${changed.size}`);

const cases = source.cases.map((item) => {
  let status = item.classification === 'automated' ? 'automated' : 'manual';
  let note = item.reason;
  if (automated.has(item.key)) {
    status = 'automated';
    note = 'Сценарий актуализирован по уточнённому ОР; точечный тест проходил. Полный набор в этом аудите не перезапускался.';
  } else if (partial.has(item.key)) {
    status = 'partial';
    note = {
      'ESN-143': 'Отписка со страницы группы проверена; отдельный путь через карточку списка не закрыт.',
      'ESN-221': 'Возврат в ленту и наличие поста проверены; точная позиция прокрутки не утверждается.',
      'ESN-422': 'Сохранение форматирования и изображения в редакторе проверено; публикация и повторное открытие не закрыты.',
    }[item.key];
  } else if (knownDefect.has(item.key)) {
    status = 'known-defect';
    note = item.key === 'ESN-335' || item.key === 'UNKEYED-01'
      ? 'Подтверждённый дефект: вложения и музыка остаются в редакторе после отмены редактирования комментария.'
      : 'Расхождение ранее подтверждено; кейс не засчитывается как работающий автотест.';
  } else if (preparationNeeded.has(item.key)) {
    status = 'preparation-needed';
    note = item.key === 'UNKEYED-02'
      ? 'Срок опроса в API-подготовке не совпал с отображаемым; проверка голосования после окончания пока не состоялась.'
      : 'Нужна надёжная подготовка данных или доработка способа автоматизации; не считать дефектом продукта без отдельного доказательства.';
  } else if (clarifyRequirement.has(item.key)) {
    status = 'clarify-requirement';
    note = 'Ожидаемое поведение ещё не подтверждено окончательно.';
  } else if (obsolete.has(item.key)) {
    status = 'obsolete';
    note = 'Счётчик просмотров видео удалён из продукта; кейс устарел.';
  } else if (item.classification === 'blocked-known-defect') {
    throw new Error(`Unreconciled deferred case: ${item.key}`);
  }
  return { ...item, status, note };
});

const statuses = ['automated', 'partial', 'manual', 'known-defect', 'preparation-needed', 'clarify-requirement', 'obsolete'];
const counts = Object.fromEntries(statuses.map((status) => [status, cases.filter((item) => item.status === status).length]));
if (cases.length !== 279 || counts.automated !== 220 || counts.partial !== 3) {
  throw new Error(`Unexpected counts: ${JSON.stringify(counts)}`);
}
const result = {
  auditedAt: new Date().toISOString(),
  basis: source.source,
  caveat: 'Статический аудит плюс ранее выполненные точечные проверки; полный набор не перезапускался. Фактический состав внешней системы тест-кейсов не считался.',
  counts: { total: cases.length, keyed: cases.filter((item) => item.hasStableSourceIdentity).length, ...counts },
  cases,
};
writeFileSync('artifacts/coverage-current-2026-09-29.json', `${JSON.stringify(result, null, 2)}\n`);

const labels = {
  automated: 'Автоматизировано полностью',
  partial: 'Частично',
  manual: 'Без автотеста',
  'known-defect': 'Известный дефект',
  'preparation-needed': 'Нужна подготовка данных/автоматизации',
  'clarify-requirement': 'Нужно уточнить требование',
  obsolete: 'Устаревший кейс',
};
const report = [
  '# Состояние покрытия на 29 сентября 2026 года',
  '',
  'Источник — локальная актуализированная база из 279 записей: 275 кейсов с ключами ESN и 4 черновых без ключа. Это **не подсчёт записей в текущей внешней системе тест-кейсов**.',
  '',
  '| Состояние | Кейсов |',
  '|---|---:|',
  ...statuses.map((status) => `| ${labels[status]} | ${counts[status]} |`),
  `| **Всего** | **${cases.length}** |`,
  '',
  'Автоматизированными считаются только кейсы, для которых есть содержательная проверка всех существенных ожиданий; `fixme` и частичное покрытие не засчитываются. Это статический аудит с учётом ранее выполненных точечных запусков, а не результат нового полного прогона.',
  '',
  'Сводный файл для импорта содержит 46 замен и 42 новых предложения. Замены не увеличивают итоговое количество; часть новых записей уже есть в локальной базе без ID. Статус их фактического импорта в систему не подтверждён.',
  '',
];
for (const status of statuses.filter((value) => value !== 'automated')) {
  report.push(`## ${labels[status]}`, '');
  for (const item of cases.filter((entry) => entry.status === status)) {
    report.push(`- ${item.key} — ${item.title}${status === 'manual' ? '' : `: ${item.note}`}`);
  }
  report.push('');
}
report.push('Поимённая матрица всех 279 записей: [coverage-current-2026-09-29.json](../artifacts/coverage-current-2026-09-29.json).');
writeFileSync('docs/STATUS-2026-09-29.md', `${report.join('\n')}\n`);
console.log(JSON.stringify(result.counts));
