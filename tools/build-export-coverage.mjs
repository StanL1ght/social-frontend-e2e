#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const exportPath = process.argv[2];
if (!exportPath) throw new Error('Usage: node tools/build-export-coverage.mjs <new-export.json>');

const latest = JSON.parse(readFileSync(exportPath, 'utf8'));
const prior = JSON.parse(readFileSync('artifacts/coverage-current-2026-09-29.json', 'utf8'));
const previous = new Map(prior.cases.map((item) => [item.key, item]));
const changed = new Set(JSON.parse(readFileSync('artifacts/new-export-audit-2026-09-29.json', 'utf8'))
  .stepChanged.map((item) => item.key));
const verifiedNew = new Set([
  'ESN-485', 'ESN-492', 'ESN-493', 'ESN-494', 'ESN-495', 'ESN-496',
  'ESN-497', 'ESN-498', 'ESN-501', 'ESN-502', 'ESN-514', 'ESN-521',
  'ESN-524', 'ESN-526', 'ESN-527',
]);
const partialNew = new Map([
  ['ESN-518', 'Права роли проверены; уведомление проверено не полностью.'],
  ['ESN-520', 'Принятие и отклонение проверены в двух группах, а не для двух заявителей одной группы; письмо не проверено.'],
  ['ESN-528', 'Редактирование и сохранение срока проверены; доставка той же изменённой записи не проверена.'],
]);
const pendingNew = new Map([
  ['ESN-483', 'Сценарий ожидаемо падает на известном расхождении при отмене редактирования комментария.'],
  ['ESN-486', 'Нет надёжной подготовки завершённого опроса.'],
  ['ESN-499', 'Проверка ограничения 16 МБ для изображения группы пока отложена.'],
  ['ESN-503', 'Черновик требует 11 реакций; сейчас в UI отображаются 10. Требуется сверить требование.'],
  ['ESN-504', 'В редакторе комментария нет предусмотренной кейсом кнопки эмодзи. Требуется сверить требование.'],
  ['ESN-510', 'Не найден устойчивый способ подготовить закреплённую публикацию собственного профиля.'],
  ['ESN-512', 'Нет проверки всей матрицы типов реакций и перехода из собственных комментариев.'],
  ['ESN-515', 'Нет проверки полного набора документов и медиа в профиле.'],
  ['ESN-519', 'У роли «Автор» нет указанного в черновике селектора авторства. Требуется сверить требование.'],
  ['ESN-522', 'Ожидаемое падение: ссылка автора меняется, видимое имя — нет. Нужно подтвердить дефект.'],
  ['ESN-523', 'Конфликт с подтверждённым ранее требованием: вкладки «Группы» в своём профиле быть не должно.'],
  ['ESN-525', 'XLSX проверен частично; отсутствует вариант ответа без голосов. Ожидаемое падение не засчитывается.'],
  ['ESN-540', 'Нужен доступ к админ-панели или API переноса публикации.'],
]);
for (const key of ['ESN-529', 'ESN-530', 'ESN-531', 'ESN-532', 'ESN-533',
  'ESN-534', 'ESN-535', 'ESN-536', 'ESN-537', 'ESN-538', 'ESN-539']) {
  pendingNew.set(key, 'Проверка письма требует доступа к тестовому ящику или API почтовых событий.');
}

function flatten(suites, parents = []) {
  return suites.flatMap((suite) => {
    const path = [...parents, suite.title];
    return [
      ...(suite.test_cases ?? []).map((item) => ({ ...item, suitePath: path })),
      ...flatten(suite.suites ?? [], path),
    ];
  });
}

const all = flatten(latest.suites);
const included = all.filter((item) => item.suitePath[0] !== 'Устаревшее');
if (new Set(included.map((item) => item.key)).size !== included.length) {
  throw new Error('Duplicate or missing case keys in included export');
}
const cases = included.map((item) => {
  const old = previous.get(item.key);
  let coverage;
  let reason;
  if (old?.status === 'automated' && !changed.has(item.key)) {
    coverage = 'automated';
    reason = 'Полностью покрыт по предыдущему поимённому аудиту; шаги в новом экспорте не менялись.';
  } else if (verifiedNew.has(item.key)) {
    coverage = 'automated';
    reason = ['ESN-492', 'ESN-493'].includes(item.key)
      ? 'Проверенный ранее сценарий получил стабильный ключ из нового экспорта; в этой сверке повторно не запускался.'
      : 'Сценарий сопоставлен с новым кейсом и прошёл точечный запуск.';
  } else if (old?.status === 'automated' && changed.has(item.key)) {
    coverage = 'review-updated';
    reason = 'Ранее автоматизирован, но ожидаемые шаги изменены; полнота автотеста по новой редакции не подтверждена.';
  } else if (partialNew.has(item.key)) {
    coverage = 'partial';
    reason = partialNew.get(item.key);
  } else if (pendingNew.has(item.key)) {
    coverage = 'not-automated';
    reason = pendingNew.get(item.key);
  } else if (old?.status === 'partial') {
    coverage = 'partial';
    reason = old.note || 'Проверена только часть ожиданий.';
  } else {
    coverage = 'not-automated';
    reason = old?.note || 'Нет подтверждённого автотеста на все ожидаемые результаты.';
  }
  return {
    key: item.key,
    title: item.title,
    caseStatus: item.status,
    suite: item.suitePath.join(' / '),
    coverage,
    reason,
  };
});
const counts = {
  total: cases.length,
  automated: cases.filter((item) => item.coverage === 'automated').length,
  partial: cases.filter((item) => item.coverage === 'partial').length,
  reviewUpdated: cases.filter((item) => item.coverage === 'review-updated').length,
  notAutomated: cases.filter((item) => item.coverage === 'not-automated').length,
  deprecatedIncluded: cases.filter((item) => item.caseStatus === 'deprecated').length,
  obsoleteExcluded: all.length - included.length,
};
if (counts.total !== Object.values(counts).slice(1, 5).reduce((a, b) => a + b, 0)) {
  throw new Error('Coverage classifications do not add up');
}
const machinePath = 'artifacts/coverage-export-2026-09-30.json';
writeFileSync(machinePath, `${JSON.stringify({ source: basename(exportPath), counts, cases }, null, 2)}\n`);

const labels = {
  'review-updated': 'Ранее автоматизированные, но изменённые кейсы — требуется сверка',
  partial: 'Частично автоматизированные',
  'not-automated': 'Без полного рабочего автотеста',
};
const report = [
  '# Покрытие по новому экспорту',
  '',
  `Источник: \`${basename(exportPath)}\`. Исключён **только** раздел «Устаревшее» (${counts.obsoleteExcluded} записей).`,
  `Остальные кейсы считаются независимо от статуса, включая ${counts.deprecatedIncluded} с \`deprecated\`.`,
  '',
  '| Состояние | Количество |',
  '|---|---:|',
  `| Полностью автоматизировано по имеющемуся аудиту | ${counts.automated} |`,
  `| Частично | ${counts.partial} |`,
  `| Изменены шаги, полнота требует пересверки | ${counts.reviewUpdated} |`,
  `| Нет полного рабочего автотеста | ${counts.notAutomated} |`,
  `| **Всего вне «Устаревшего»** | **${counts.total}** |`,
  '',
  `Таким образом, **${counts.total - counts.automated} кейсов не засчитаны как полностью автоматизированные**.`,
  'Это консервативный аудит: ранее проверенные кейсы с неизменными шагами сохранены как покрытые; изменение шагов снимает зачёт до повторной сверки.',
  'Метка `fixme`, ожидаемое падение и наличие ID в файле сами по себе покрытием не считаются. Полный регрессионный прогон сегодня не выполнялся.',
  '',
];
for (const status of ['review-updated', 'partial', 'not-automated']) {
  report.push(`## ${labels[status]}`, '');
  for (const item of cases.filter((entry) => entry.coverage === status)) {
    report.push(`- ${item.key} — ${item.title}${item.caseStatus === 'deprecated' ? ' [deprecated]' : ''}: ${item.reason}`);
  }
  report.push('');
}
report.push(`Полная поимённая матрица, включая ${counts.automated} зачтённых кейса: [coverage-export-2026-09-30.json](../${machinePath}).`);
writeFileSync('docs/COVERAGE-EXPORT-2026-09-30.md', `${report.join('\n')}\n`);
console.log(JSON.stringify(counts));
