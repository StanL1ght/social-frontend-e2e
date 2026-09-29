import copy
import json
from datetime import datetime
from pathlib import Path


root = Path(__file__).parent
source = json.loads((root / 'Все кейсы — точечная актуализация.json').read_text(encoding='utf-8'))
data = copy.deepcopy(source)


def walk_suites(suites):
    for suite in suites:
        yield suite
        yield from walk_suites(suite.get('suites', []))


def get(case_id):
    for suite in walk_suites(data['suites']):
        for case in suite.get('test_cases', []):
            if case.get('id') == case_id:
                return case
    raise ValueError(case_id)


def steps(pairs):
    return [dict(position=i, action=a, expected_result=e) for i, (a, e) in enumerate(pairs, 1)]


c = get(7542)
c['steps'][7]['expected_result'] = 'Название выбранного дивизиона отображается непосредственно в селекторе «Дивизион»; после заполнения обязательных полей доступна кнопка «Создать».'
c['steps'][9]['expected_result'] = 'Появляется сообщение «Группа успешно создана»; новая группа доступна на всех вкладках списка групп, включая «Вы подписаны», «Вы автор» и «Все группы». Введённые данные сохранены.'

c = get(7603)
c['title'] = 'Кеширование списка групп'
c['description'] = 'После открытия группы и возврата к списку групп сохраняется позиция прокрутки списка.'

c = get(10360)
c['status'] = 'actual'
c['title'] = 'Повторное добавление одинакового файла в публикацию'
c['description'] = 'Один и тот же документ можно добавить несколько раз; каждое добавление создаёт отдельное вложение в редакторе и опубликованной записи.'
c['preconditions'] = 'Пользователь авторизован; открыт редактор новой публикации; подготовлен валидный документ Word или PDF размером не более 100 МБ.'
c['steps'] = steps([
    ('Ввести заголовок и через кнопку «Документ (Word, PDF)» добавить подготовленный файл.', 'В редакторе появилось одно вложение с названием файла.'),
    ('Через ту же кнопку ещё два раза выбрать тот же файл.', 'После каждого добавления появляется отдельное вложение; в редакторе видны три одинаковых файла, ни один не заменил предыдущий.'),
    ('Открыть предпросмотр публикации.', 'В предпросмотре отображаются три отдельных вложения с одинаковым названием.'),
    ('Вернуться в редактор и нажать «Сейчас», затем открыть опубликованную запись.', 'Запись опубликована; в ней отображаются три отдельных вложения, каждое доступно для скачивания.'),
])

c = get(10370)
c['status'] = 'actual'
c['title'] = 'Очистка редактора от контента при закрытии и удалении изменений'
c['description'] = 'После закрытия редактора с выбором «Закрыть и удалить изменения» несохранённый контент не восстанавливается.'
c['steps'] = steps([
    ('Добавить в редактор уникальные заголовок и текст без сохранения.', 'Заголовок и текст видны в редакторе.'),
    ('Закрыть редактор крестиком и в окне «Сохранить изменения?» выбрать «Закрыть и удалить изменения».', 'Редактор закрыт; черновик не создан.'),
    ('Снова открыть редактор через «Написать».', 'Открылся новый пустой редактор; несохранённых заголовка и текста нет.'),
])

c = get(10377)
c['status'] = 'actual'
c['title'] = 'Вставка текста с изображением из Word в публикацию'
c['description'] = 'При копировании фрагмента Word встроенное изображение должно вставляться вместе с текстом и сохранять своё место между текстовыми частями в редакторе, предпросмотре и опубликованной записи. Проверка форматирования текста вынесена в отдельный кейс.'
c['preconditions'] = 'Пользователь авторизован; открыт редактор новой публикации. Подготовлен документ Word: текст до изображения, встроенное изображение, текст после изображения. Изображение имеет допустимый формат и размер; файл Word доступен для копирования фрагмента.'
c['steps'] = steps([
    ('Ввести заголовок публикации; в Word выделить и скопировать фрагмент вместе с обоими текстовыми частями и встроенным изображением.', 'Скопирован фрагмент, включающий текст и изображение.'),
    ('Поставить курсор в область содержимого публикации и вставить фрагмент.', 'В редакторе появились обе текстовые части и изображение между ними; изображение не потеряно.'),
    ('Открыть предпросмотр.', 'Текст и изображение отображаются в том же порядке.'),
    ('Вернуться в редактор, нажать «Сейчас» и открыть опубликованную запись.', 'Публикация содержит обе текстовые части и изображение между ними; изображение открывается как вложение публикации.'),
])

editor_suite = next(s for s in walk_suites(data['suites']) if s['title'] == 'Редактор публикаций')
new_refresh = {
    'title': 'Очистка редактора от контента при обновлении страницы',
    'position': max(x.get('position', 0) for x in editor_suite['test_cases']) + 1,
    'type': 'other', 'status': 'actual', 'severity': 'undefined',
    'priority': 'medium', 'behavior': 'undefined', 'layer': 'unknown',
    'automation_status': 'manual', 'is_flaky': False,
    'to_be_automated': False, 'muted_case': False,
    'description': 'После обновления страницы открытый редактор закрывается; несохранённый контент не восстанавливается при повторном открытии.',
    'preconditions': 'Пользователь авторизован; открыт редактор новой публикации.',
    'steps': steps([
        ('Ввести уникальные заголовок и текст без сохранения.', 'Заголовок и текст видны в редакторе.'),
        ('Обновить страницу браузера.', 'После загрузки страницы редактор закрыт.'),
        ('Открыть редактор через «Написать».', 'Открывается пустой редактор; введённые до обновления заголовок и текст отсутствуют.'),
    ]),
}
editor_suite['test_cases'].append(new_refresh)


changed_ids = {7429, 7542, 7603, 10339, 10360, 10370, 10372, 10377}


def filtered_suite(suite):
    result = {k: copy.deepcopy(v) for k, v in suite.items() if k not in ('test_cases', 'suites')}
    result['test_cases'] = [copy.deepcopy(c) for c in suite.get('test_cases', [])
                            if c.get('id') in changed_ids or 'id' not in c]
    result['suites'] = [sub for child in suite.get('suites', [])
                        if (sub := filtered_suite(child)) is not None]
    if result['test_cases'] or result['suites']:
        return result
    return None


selection = [s for original_suite in data['suites']
             if (s := filtered_suite(original_suite)) is not None]
all_suites = list(walk_suites(selection))
all_cases = [c for suite in all_suites for c in suite.get('test_cases', [])]

output = {
    'schema_version': data['schema_version'],
    'exported_at': datetime.now().astimezone().isoformat(),
    'project': data['project'],
    'selection': {'scope': 'suites', 'suite_ids': [s['id'] for s in selection]},
    'summary': {
        'suite_count': len(all_suites),
        'test_case_count': len(all_cases),
        'step_count': sum(len(c.get('steps', [])) for c in all_cases),
    },
    'suites': selection,
}

path = root / 'Изменённые и новые кейсы — 2026-09-22.json'
path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(path)
print(output['summary'])
