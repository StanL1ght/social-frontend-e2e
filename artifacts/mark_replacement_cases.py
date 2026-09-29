import copy
import json
from pathlib import Path


root = Path(__file__).parent
source_path = root / 'Уведомления, заявки, опросы и роли — изменённые и новые кейсы.json'
output_path = root / 'Уведомления, заявки, опросы и роли — для импорта с пометками.json'
data = copy.deepcopy(json.loads(source_path.read_text(encoding='utf-8')))

replacement_count = 0
new_count = 0


def walk(suites):
    for suite in suites:
        yield suite
        yield from walk(suite.get('suites', []))


for suite in walk(data['suites']):
    for case in suite.get('test_cases', []):
        old_key = case.get('key')
        if old_key:
            replacement_count += 1
            case['title'] = f'[ЗАМЕНА {old_key}] {case["title"]}'
            note = f'ЗАМЕНЯЕТ СУЩЕСТВУЮЩИЙ КЕЙС {old_key}. Перед импортом или после него удалить старую версию кейса.'
            description = (case.get('description') or '').strip()
            case['description'] = f'{note}\n\n{description}' if description else note
            # Импортёр создаёт новые кейсы и не обновляет существующие. Удаляем
            # экспортные идентификаторы, чтобы замена гарантированно импортировалась
            # как самостоятельный кейс, а исходный ключ оставался только в пометке.
            case.pop('id', None)
            case.pop('key', None)
        else:
            new_count += 1
            case['title'] = f'[НОВЫЙ] {case["title"]}'

data['summary']['replacement_case_count'] = replacement_count
data['summary']['new_case_count'] = new_count
output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(output_path)
print({'replacements': replacement_count, 'new': new_count})
