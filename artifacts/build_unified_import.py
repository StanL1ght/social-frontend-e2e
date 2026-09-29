import copy
import json
import re
from datetime import datetime
from pathlib import Path


root = Path(__file__).parent
original = json.loads(Path('/Users/stanislav/Downloads/Все кейсы.json').read_text(encoding='utf-8'))
baseline = json.loads((root / 'Все кейсы — точечная актуализация.json').read_text(encoding='utf-8'))


def walk(suites, path=()):
    for suite in suites:
        current = path + (suite['title'],)
        yield suite, current
        yield from walk(suite.get('suites', []), current)


def cases_by_id(data):
    return {
        case['id']: (path, case)
        for suite, path in walk(data['suites'])
        for case in suite.get('test_cases', [])
        if 'id' in case
    }


def strip_marker(title):
    return re.sub(r'^\[(?:ЗАМЕНА [^]]+|НОВЫЙ)]\s*', '', title).strip()


def comparable(case):
    return {k: v for k, v in case.items() if k != 'position'}


original_ids = cases_by_id(original)
baseline_ids = cases_by_id(baseline)
key_locations = {
    case.get('key'): path
    for suite, path in walk(baseline['suites'])
    for case in suite.get('test_cases', [])
    if case.get('key')
}

replacements = {}
new_cases = {}


def put_case(path, case):
    item = copy.deepcopy(case)
    title = strip_marker(item['title'])
    item['title'] = title
    key = item.get('key')
    if key:
        replacements[key] = (path, item)
    else:
        new_cases[title.casefold()] = (path, item)


# Точечные отличия общей базы от исходного пользовательского экспорта.
for case_id, (path, case) in baseline_ids.items():
    old = original_ids.get(case_id)
    if old and (old[0] != path or comparable(old[1]) != comparable(case)):
        put_case(path, case)

for suite, path in walk(baseline['suites']):
    for case in suite.get('test_cases', []):
        if 'id' not in case or case.get('id') not in original_ids:
            put_case(path, case)


def ingest_export(filename):
    data = json.loads((root / filename).read_text(encoding='utf-8'))
    for suite, path in walk(data['suites']):
        for case in suite.get('test_cases', []):
            put_case(path, case)


# Более поздние результаты этого чата имеют приоритет над общей базой.
for filename in (
    'Изменённые и новые кейсы — 2026-09-22.json',
    'Новые кейсы — изображение группы — 2026-09-22.json',
    'Новые кейсы — мои публикации — 2026-09-22.json',
    'Реакции, профили и роли — изменённые и новые кейсы.json',
    'Уведомления, заявки, опросы и роли — изменённые и новые кейсы.json',
):
    ingest_export(filename)

# Полные new_case из соседнего чата заменяют соответствующие старые версии.
neighbor = json.loads((root / 'кейсы-замены-после-уточнений-2026-09-28.json').read_text(encoding='utf-8'))
for entry in neighbor['replacement_cases']:
    key = entry['old_case']['key']
    case = copy.deepcopy(entry['new_case'])
    case['key'] = key
    path = key_locations.get(key)
    if not path:
        raise ValueError(f'Не найден сьют для {key}')
    put_case(path, case)

# ESN-136 был содержательно расширен в этом чате. Сохраняем полную проверку
# фактических прав, но применяем позднее уточнение: тост не является ОР.
reaction_export = json.loads((root / 'Реакции, профили и роли — изменённые и новые кейсы.json').read_text(encoding='utf-8'))
for suite, path in walk(reaction_export['suites']):
    for case in suite.get('test_cases', []):
        if case.get('key') == 'ESN-136':
            merged = copy.deepcopy(case)
            for step in merged.get('steps', []):
                expected = step.get('expected_result') or ''
                if 'Права пользователя обновлены' in expected:
                    step['expected_result'] = ('Роль сохранена; в списке участников указана роль '
                                               '«Администратор». Отображение тоста не обязательно.')
            put_case(path, merged)

# Общее продуктовое переименование роли применяется и к поздним кейсам соседа.
role_replacements = {
    'Добавить подписчиков': 'Добавить пользователей',
    'ролью «Подписчик»': 'ролью «Пользователь»',
    'роль «Подписчик»': 'роль «Пользователь»',
    'для автора и подписчика': 'для автора и пользователя',
}


def replace_strings(value):
    if isinstance(value, str):
        for old, new in role_replacements.items():
            value = value.replace(old, new)
        return value
    if isinstance(value, list):
        return [replace_strings(x) for x in value]
    if isinstance(value, dict):
        return {k: replace_strings(v) for k, v in value.items()}
    return value


replacements = {key: (path, replace_strings(case)) for key, (path, case) in replacements.items()}

# Уточнение переноса публикации: если исходный автор доступен в целевой
# группе, он должен сохраниться.
move_path = key_locations['ESN-474']
move_case = copy.deepcopy(baseline_ids[next(
    case_id for case_id, (_, case) in baseline_ids.items() if case.get('key') == 'ESN-474'
)][1])
move_case['description'] = ('Проверить перенос публикации в другую группу с сохранением автора, '
                            'если этот пользователь состоит в целевой группе.')
move_case['preconditions'] = (
    'Администратор авторизован; открыт раздел «Управление». В группе A есть '
    'тестовая публикация. Её автор состоит в группах A и B; группа B активна.'
)
move_case['steps'] = [
    {
        'position': 1,
        'action': 'На вкладке «Посты» найти публикацию группы A и открыть действие «Переместить».',
        'expected_result': 'Форма показывает группу A как текущее место публикации и исходного автора.',
    },
    {
        'position': 2,
        'action': 'Выбрать группу B.',
        'expected_result': ('Группа B выбрана как новое место; поскольку исходный автор состоит '
                            'в группе B, в селекторе автора остаётся тот же пользователь.'),
    },
    {
        'position': 3,
        'action': 'Подтвердить перенос.',
        'expected_result': 'В административной таблице для публикации указана группа B; автор не изменился.',
    },
    {
        'position': 4,
        'action': 'Открыть публикацию и обе группы в соцсети.',
        'expected_result': ('Публикация находится в группе B и отсутствует в группе A; исходный '
                            'автор, заголовок и содержимое сохранены.'),
    },
]
put_case(move_path, move_case)


def plain_case(title, description, preconditions, steps, status='actual'):
    return {
        'title': title,
        'position': 0,
        'type': 'other',
        'status': status,
        'severity': 'undefined',
        'priority': 'medium',
        'behavior': 'undefined',
        'layer': 'unknown',
        'automation_status': 'manual',
        'is_flaky': False,
        'to_be_automated': False,
        'muted_case': False,
        'description': description,
        'preconditions': preconditions,
        'steps': [
            {'position': i, 'action': action, 'expected_result': expected}
            for i, (action, expected) in enumerate(steps, 1)
        ],
    }


put_case(('Группы',), plain_case(
    'Смена автора публикации при редактировании владельцем или администратором группы',
    ('Проверить, что администратор или владелец группы может изменить автора '
     'существующей публикации. Владелец проверяется в рамках тех же прав администратора.'),
    ('Пользователь является администратором или владельцем тестовой группы. В группе '
     'есть публикация и не менее двух пользователей, доступных для выбора автором.'),
    [
        ('Открыть меню действий публикации и выбрать «Редактировать».',
         'Открывается редактор существующей публикации; доступен селектор автора.'),
        ('В селекторе автора выбрать другого пользователя.',
         'В селекторе отображается выбранный пользователь; остальные данные публикации не изменяются.'),
        ('Сохранить изменения.',
         'Редактор закрывается; публикация остаётся в той же группе.'),
        ('Открыть публикацию после сохранения.',
         'В карточке и детальном просмотре указан новый автор; ссылка его имени открывает правильный профиль, содержимое публикации сохранено.'),
    ],
))

put_case(('Управление',), plain_case(
    'Перенос публикации в группу, в которой нет исходного автора',
    ('Проверить автоматическую замену автора при переносе публикации в группу, '
     'где исходный автор отсутствует. Конкретный автоматически выбранный пользователь не фиксируется.'),
    ('Администратор авторизован; открыт раздел «Управление». В группе A есть '
     'публикация; её автор не состоит в активной группе B. В группе B доступен хотя бы один другой автор.'),
    [
        ('На вкладке «Посты» найти публикацию группы A и открыть действие «Переместить».',
         'Форма показывает группу A и исходного автора.'),
        ('Выбрать группу B.',
         'Группа B выбрана; селектор автора автоматически меняется на доступного для группы B пользователя, отличного от исходного автора.'),
        ('Подтвердить перенос.',
         'Перенос выполняется; в административной таблице указаны группа B и автоматически выбранный автор.'),
        ('Открыть публикацию и обе группы в соцсети.',
         'Публикация находится в группе B и отсутствует в группе A; указан новый автор, заголовок и содержимое сохранены.'),
    ],
))

editor_path = ('Редактор публикаций - актуализированный', 'Редактор публикаций')

put_case(editor_path, plain_case(
    'Валидация даты и времени запланированной публикации',
    ('Проверить запрет планирования задним числом и раньше минимально допустимого '
     'времени, а также разблокировку подтверждения после ввода валидного значения.'),
    'Пользователь авторизован; открыт редактор новой публикации; введён валидный заголовок.',
    [
        ('Нажать «В точное время».',
         ('Открывается окно «Публикация в точное время» с полями «Дата» и «Время», '
          'кнопками «Отменить» и «Опубликовать в указанное время». Указано, что время '
          'должно быть не раньше чем через одну минуту, а редактирование доступно не позднее чем за пять минут до публикации.')),
        ('Указать сегодняшнюю дату и прошедшее время либо время менее чем через одну минуту.',
         ('Показывается ошибка «Нельзя публиковать задним числом — выберите время не '
          'раньше чем через минуту»; кнопка «Опубликовать в указанное время» недоступна.')),
        ('Указать дату раньше сегодняшней.',
         'Планирование не подтверждается; кнопка публикации остаётся недоступной и отображается сообщение о некорректной дате или времени.'),
        ('Указать сегодняшнюю или будущую дату и время не раньше чем через одну минуту.',
         'Ошибка исчезает; кнопка «Опубликовать в указанное время» становится доступной.'),
        ('Нажать «Отменить».',
         'Окно планирования закрывается; публикация не создаётся и редактор остаётся открытым.'),
    ],
))

put_case(editor_path, plain_case(
    'Редактирование запланированной публикации ранее чем за 5 минут до публикации',
    'Проверить возможность изменить запланированную публикацию, пока до выбранного времени остаётся больше пяти минут.',
    ('Пользователь авторизован; публикация запланирована более чем через пять минут и '
     'отображается в «Мои публикации» → «Запланированные».'),
    [
        ('Открыть меню действий запланированной публикации.',
         'Доступно действие редактирования публикации.'),
        ('Открыть редактирование, изменить заголовок или содержимое и сохранить.',
         'Изменения сохраняются; публикация остаётся в списке запланированных на выбранное время.'),
        ('Повторно открыть запланированную публикацию.',
         'Отображается изменённый контент; дата и время публикации сохранены.'),
        ('Дождаться срока публикации и открыть место назначения.',
         'Публикация появляется один раз в назначенном месте с изменённым контентом.'),
    ],
))

put_case(editor_path, plain_case(
    'Запрет редактирования и отмена публикации за 5 минут до запланированного времени',
    ('Проверить, что в последние пять минут запланированную публикацию нельзя '
     'редактировать, но можно отменить.'),
    ('Пользователь авторизован; до времени запланированной публикации осталось не '
     'более пяти минут; запись отображается в «Мои публикации» → «Запланированные».'),
    [
        ('Открыть меню действий запланированной публикации.',
         'Редактирование недоступно; доступно действие отмены запланированной публикации.'),
        ('Выбрать отмену публикации.',
         'Показывается подтверждение отмены; публикация ещё остаётся запланированной.'),
        ('Подтвердить отмену.',
         'Публикация исчезает из списка запланированных.'),
        ('Дождаться ранее выбранного времени и обновить место назначения.',
         'Отменённая публикация не появляется в ленте, группе или профиле и не публикуется позднее.'),
    ],
))


def import_case(case, marker, old_key=None):
    result = copy.deepcopy(case)
    clean_title = strip_marker(result['title'])
    if old_key:
        result['title'] = f'[ЗАМЕНА {old_key}] {clean_title}'
        note = (f'ЗАМЕНЯЕТ СУЩЕСТВУЮЩИЙ КЕЙС {old_key}. '
                'Старую версию перенести в сьют «Устаревшее» и оставить этот импортированный кейс в рабочем сьюте.')
        description = (result.get('description') or '').strip()
        if not description.startswith('ЗАМЕНЯЕТ СУЩЕСТВУЮЩИЙ КЕЙС'):
            result['description'] = f'{note}\n\n{description}' if description else note
    else:
        result['title'] = f'[НОВЫЙ] {clean_title}'
    result.pop('id', None)
    result.pop('key', None)
    return result


# Метаданные и иерархия сьютов берутся из общей базы; для нового сьюта
# «Мои публикации» создаётся минимальная импортная оболочка.
suite_meta = {path: suite for suite, path in walk(baseline['suites'])}
selected = {}


def append(path, case):
    selected.setdefault(path, []).append(case)


for key, (path, case) in sorted(replacements.items()):
    append(path, import_case(case, 'replacement', key))
for _, (path, case) in sorted(new_cases.items()):
    append(path, import_case(case, 'new'))


def suite_shell(path):
    meta = suite_meta.get(path)
    if meta:
        shell = {k: copy.deepcopy(v) for k, v in meta.items() if k not in ('test_cases', 'suites')}
    else:
        shell = {'title': path[-1], 'position': 0, 'path': list(path)}
    shell['test_cases'] = selected.get(path, [])
    shell['suites'] = []
    return shell


all_paths = set(selected)
for path in list(all_paths):
    for i in range(1, len(path)):
        all_paths.add(path[:i])

shells = {path: suite_shell(path) for path in sorted(all_paths, key=lambda p: (len(p), p))}
top = []
for path in sorted(shells, key=lambda p: (len(p), p)):
    if len(path) == 1:
        top.append(shells[path])
    else:
        shells[path[:-1]]['suites'].append(shells[path])

all_suites = list(walk(top))
all_cases = [c for suite, _ in all_suites for c in suite.get('test_cases', [])]
output = {
    'schema_version': baseline['schema_version'],
    'exported_at': datetime.now().astimezone().isoformat(),
    'project': baseline['project'],
    'selection': {
        'scope': 'suites',
        'suite_ids': [s['id'] for s in top if s.get('id') is not None],
    },
    'summary': {
        'suite_count': len(all_suites),
        'test_case_count': len(all_cases),
        'replacement_case_count': len(replacements),
        'new_case_count': len(new_cases),
        'step_count': sum(len(c.get('steps', [])) for c in all_cases),
    },
    'suites': top,
}

output_path = root / 'ОБЩИЙ СПИСОК — кейсы из двух чатов — для импорта.json'
output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

obsolete_path = root / 'ОБЩИЙ СПИСОК — перенести в Устаревшее.txt'
obsolete_path.write_text(
    'Перенести в существующий сьют «Устаревшее» без создания нового кейса:\n'
    'ESN-310 — «Работа счётчика просмотров видео». Счётчик удалён из продукта.\n',
    encoding='utf-8',
)

print(output_path)
print(output['summary'])
print(obsolete_path)
