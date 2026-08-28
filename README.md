# E2E-автотесты Social Frontend

Проект на TypeScript и Playwright Test для сайта:

https://dev-social-frontend.sddt.efko.ru/

Проект содержит:

- 35 тестов в 15 spec-файлах;
- сохранение авторизованной сессии;
- desktop-тесты в Chromium;
- мобильные тесты в Chromium и WebKit;
- smoke-навигацию;
- проверки глобального поиска и каталога персон;
- проверки служебных маршрутов;
- создание поста, комментария, реакции и группы;
- удаление тестовых данных только через интерфейс;
- сравнение индексации постов из личной ленты и группы;
- HTML-отчёт, screenshot, video и trace при падении;
- сохранение подходящих API-запросов и ответов в network.json;
- автоматическое удаление токенов, cookies, паролей и других секретов из network.json.

## Быстрая установка на Mac с Apple Silicon

Для Mac с чипом M1/M2/M3/M4 можно не выполнять команды вручную:

1. Распакуйте архив.
2. Дважды нажмите `SETUP-MAC.command`.
3. Если macOS заблокирует первый запуск: нажмите правой кнопкой по файлу → «Открыть» → «Открыть».
4. Подтвердите официальный вход GitHub в открывшемся браузере.

Установщик сам создаст папку `~/Projects/social-frontend-e2e`, установит Node.js, GitHub CLI, зависимости и браузеры Playwright, создаст приватный GitHub-репозиторий и отправит туда код. Реальные логины и пароли в GitHub не попадают: `.env` создаётся только локально и исключён из Git.

Если Homebrew отсутствует, установщик поставит его с официального установочного скрипта. macOS может попросить пароль пользователя компьютера — это запрос самой системы, а не проекта.

## 1. Что установить

### Windows 10/11

1. Установить Node.js LTS 20 или 22:
   https://nodejs.org/
2. При установке оставить включённым пункт добавления Node.js в PATH.
3. Установить Visual Studio Code:
   https://code.visualstudio.com/
4. В VS Code установить расширение Playwright Test for VSCode от Microsoft.
5. Открыть PowerShell и проверить:

~~~powershell
node --version
npm --version
~~~

### macOS

1. Установить Node.js LTS 20 или 22 с сайта https://nodejs.org/ либо через Homebrew:

~~~bash
brew install node@22
~~~

2. Проверить установку:

~~~bash
node --version
npm --version
~~~

## 2. Распаковать и открыть проект

### Windows PowerShell

~~~powershell
Expand-Archive .\social-frontend-e2e.zip -DestinationPath .\
cd .\social-frontend-e2e
code .
~~~

### macOS

~~~bash
unzip social-frontend-e2e.zip
cd social-frontend-e2e
code .
~~~

Если команда code не найдена, проект можно открыть через меню VS Code:

File → Open Folder → social-frontend-e2e.

## 3. Установить зависимости

В терминале, открытом в папке проекта:

~~~bash
npm install
npx playwright install chromium webkit
~~~

На Linux вместо второй команды:

~~~bash
npx playwright install --with-deps chromium webkit
~~~

## 4. Создать файл с настройками

Логин и пароль не хранятся в проекте. Они читаются из локального файла .env, который исключён из Git.

### Windows PowerShell

~~~powershell
Copy-Item .env.example .env
notepad .env
~~~

### macOS

~~~bash
cp .env.example .env
open -e .env
~~~

Заполнить файл:

~~~dotenv
BASE_URL=https://dev-social-frontend.sddt.efko.ru
E2E_EMAIL=логин_тестового_пользователя
E2E_PASSWORD=пароль_тестового_пользователя
RUN_MUTATION_TESTS=false
NETWORK_URL_FILTER=multisearch|multi-search|private-web|search|catalog|person|post|group
~~~

Важно:

- не отправлять .env в Git;
- использовать только тестового пользователя;
- если пароль содержит #, пробелы или другие специальные символы, заключить значение в двойные кавычки;
- не менять RUN_MUTATION_TESTS на true, пока не готовы создавать и удалять тестовые данные.

## 5. Первый безопасный запуск

По умолчанию npm test не запускает mutation-тесты.

~~~bash
npm test
~~~

При первом запуске setup-тест авторизуется и сохранит cookies/localStorage в:

~~~text
.auth/user.json
~~~

Файл также исключён из Git.

Если сессия протухла, удалить файл и запустить тесты снова.

### Windows PowerShell

~~~powershell
Remove-Item .auth\user.json
npm test
~~~

### macOS

~~~bash
rm .auth/user.json
npm test
~~~

## 6. Основные команды

### Все безопасные read-only тесты

~~~bash
npm test
~~~

### Только smoke

~~~bash
npm run test:smoke
~~~

### Только desktop Chromium

~~~bash
npm run test:desktop
~~~

### Только мобильный вид

Будут запущены Pixel 7 в Chromium и iPhone 13 в WebKit.

~~~bash
npm run test:mobile
~~~

### Запуск с открытым браузером

~~~bash
npm run test:headed
~~~

### UI-режим Playwright

Удобен для обучения: можно выбирать тесты, смотреть шаги и DOM.

~~~bash
npm run test:ui
~~~

### Пошаговая отладка

~~~bash
npm run test:debug
~~~

### Проверка TypeScript

~~~bash
npm run typecheck
~~~

## 7. Запуск тестов, которые меняют данные

Mutation-тесты:

- создают личный пост;
- ставят реакцию;
- создают комментарий;
- проверяют пост в «Моих публикациях»;
- удаляют пост через UI;
- создают публичную группу;
- удаляют группу через UI;
- сравнивают глобальный поиск личного поста и поста группы.

Для запуска:

~~~bash
npm run test:mutation
~~~

Скрипт сам временно устанавливает RUN_MUTATION_TESTS=true.

Для запуска вообще всех тестов:

~~~bash
npm run test:all
~~~

Тестовые сущности получают уникальные имена вида:

~~~text
QA-E2E-POST-20260828153000-A1B2C
QA-E2E-COMMENT-20260828153000-D3E4F
QA-E2E-GROUP-20260828153000-G5H6I
~~~

Очистка выполняется в блоке finally. Если браузер аварийно закрыт или процесс принудительно остановлен, очистка может не выполниться. В таком случае найти сущности по префиксу QA-E2E и удалить вручную через интерфейс.

## 8. Что проверяют тесты

### feed.spec.ts

- загрузку карточек ленты;
- writer;
- подгрузку дополнительных публикаций при прокрутке.

### group-list.spec.ts

- вкладки «Вы подписаны», «Вы автор» и «Все группы»;
- маршруты вкладок;
- поиск по группам.

### my-publications.spec.ts

- вкладки и счётчики;
- маршруты опубликованных, запланированных и черновиков.

### profile.spec.ts

- открытие своей страницы;
- основные вкладки профиля.

### post-readonly.spec.ts

- открытие существующего собственного поста;
- «Копировать ссылку»;
- тост «Ссылка скопирована».

### access.spec.ts

- пользователь без прав администратора не остаётся на /admin.

### navigation.spec.ts

- редирект с / на /feed;
- переходы в «Лента», «Группы», «Персоны», «Моя страница», «Мои публикации».

### routes.spec.ts

- неизвестный маршрут должен вести на /404/not-found;
- /hashtag без id должен вести на 404;
- отсутствующий пост показывает «Пост не найден».

Первые два сценария помечены @known-bug и используют test.fail: Playwright считает текущее ожидаемое падение известным. Если дефект исправят, тест неожиданно пройдёт и потребует удалить test.fail.

### global-search.spec.ts

- открытие поиска;
- закрытие по Escape;
- минимальное количество символов;
- появление категорий;
- сохранение трафика мультипоиска.

### persons.spec.ts

- открытие каталога;
- поиск;
- переход в профиль;
- сохранение трафика отдельного endpoint каталога.

### mobile-layout.spec.ts

- элементы мобильной шапки групп;
- доступное имя кнопки поиска;
- отсутствие горизонтального переполнения.

### post-lifecycle.spec.ts

- создание поста в личной ленте;
- реакция;
- комментарий;
- отображение в «Моих публикациях»;
- удаление через UI;
- состояние «Пост не найден».

### group-lifecycle.spec.ts

- создание публичной группы;
- выбранный дивизион и описание;
- статус администратора;
- удаление через UI;
- состояние удалённой группы по прямому URL.

### publication-indexing.spec.ts

- создаёт временную группу;
- создаёт пост в личной ленте;
- создаёт пост в группе;
- ищет оба поста через глобальный поиск;
- сохраняет indexing-comparison.json;
- сохраняет сетевые запросы и ответы;
- удаляет оба поста и группу через UI.

## 9. Сетевой трафик

Каждый тест автоматически подписывается на request и response.

В артефакт network.json попадают только URL, соответствующие NETWORK_URL_FILTER. По умолчанию это поиск, каталог персон, посты и группы.

Для каждого запроса сохраняются:

- время;
- HTTP-метод;
- URL;
- status code;
- request body;
- JSON response body.

Перед сохранением рекурсивно заменяются на [REDACTED] поля, содержащие:

- authorization;
- cookie;
- token;
- password;
- secret.

Где найти:

~~~text
test-results/<название-теста>/attachments/network-*.json
~~~

Файл также доступен во вкладке Attachments HTML-отчёта.

Если нужный endpoint не попал в лог, расширить регулярное выражение NETWORK_URL_FILTER в .env.

Пример:

~~~dotenv
NETWORK_URL_FILTER=multisearch|private-web|api/persons|api/search
~~~

## 10. Отчёты и диагностика падений

После тестов открыть HTML-отчёт:

~~~bash
npm run report
~~~

При падении Playwright сохраняет:

- screenshot только в момент ошибки;
- video;
- trace;
- network.json.

Открыть trace вручную:

~~~bash
npx playwright show-trace test-results/папка-теста/trace.zip
~~~

В trace можно посмотреть:

- правильный скрин каждого шага;
- DOM;
- действия;
- console;
- network;
- время ожиданий.

Это полезнее одиночного скриншота белой области: видно последовательность до и после дефекта.

## 11. Запуск одного файла или теста

Один spec:

~~~bash
npx playwright test tests/search/global-search.spec.ts
~~~

Один тест по названию:

~~~bash
npx playwright test -g "открывается и закрывается"
~~~

Один браузер:

~~~bash
npx playwright test --project=mobile-webkit
~~~

Один mutation-тест:

### Windows PowerShell

~~~powershell
$env:RUN_MUTATION_TESTS="true"
npx playwright test tests/posts/post-lifecycle.spec.ts
Remove-Item Env:RUN_MUTATION_TESTS
~~~

### macOS

~~~bash
RUN_MUTATION_TESTS=true npx playwright test tests/posts/post-lifecycle.spec.ts
~~~

## 12. Как добавить новый тест

1. Выбрать подходящую папку в tests.
2. Переиспользовать Page Object из tests/pages.
3. Для read-only теста импортировать:

~~~typescript
import { test, expect } from '../fixtures/test';
~~~

4. Для теста с изменением данных добавить @mutation в describe или название теста.
5. В начале mutation-набора добавить:

~~~typescript
test.skip(!env.runMutationTests, 'Для запуска установите RUN_MUTATION_TESTS=true');
~~~

6. Создавать уникальные данные через uniqueMarker.
7. Удалять созданные данные в finally и только через интерфейс.
8. Проверять результат через expect, а не через фиксированные паузы.

## 13. Известные особенности проекта

- Локаторы построены по ролям, доступным именам и видимому тексту интерфейса.
- Если разработчики переименуют элементы, локаторы нужно обновить.
- Часть списков загружается с задержкой, поэтому для API-зависимых элементов используются ожидания до 15–20 секунд.
- Доступное имя поиска проверяется только в мобильных проектах.
- Глобальный поиск и каталог персон анализируются отдельно: они используют разные API.
- Проект не делает вывод о причине дефекта только по UI. Для этого сохраняется network.json.

## 14. Частые проблемы

### Не заданы E2E_EMAIL и E2E_PASSWORD

Проверить, что файл называется именно .env, а не .env.txt.

В Windows включить отображение расширений:

Проводник → Вид → Показывать → Расширения имён файлов.

### browserType.launch: Executable doesn't exist

~~~bash
npx playwright install chromium webkit
~~~

### Авторизация зациклилась или открывается login

Удалить .auth/user.json и запустить снова.

### Тест не находит элемент, хотя он виден

Запустить:

~~~bash
npm run test:debug
~~~

Проверить доступное имя через Playwright Inspector и при необходимости обновить локатор.

### После аварийного запуска остались данные

Найти в интерфейсе сущности с префиксом QA-E2E и удалить вручную. Не удалять записи через API или базу, если проверяется именно UI-удаление.

## 15. Рекомендуемый порядок работы

1. npm install
2. npx playwright install chromium webkit
3. Создать .env.
4. npm run typecheck
5. npm run test:smoke
6. npm run test:desktop
7. npm run test:mobile
8. Просмотреть HTML-отчёт.
9. Проверить network.json для поиска и персон.
10. Только после этого запустить npm run test:mutation.
