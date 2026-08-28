#!/bin/bash

set -Eeuo pipefail

PROJECT_NAME="social-frontend-e2e"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$HOME/Projects/$PROJECT_NAME"

on_error() {
  local exit_code=$?
  echo
  echo "Установка остановилась на строке $1 (код $exit_code)."
  echo "Скопируйте этот текст в чат Codex — я продолжу с места остановки."
  echo
  read -r -p "Нажмите Enter, чтобы закрыть окно..." _
  exit "$exit_code"
}

trap 'on_error $LINENO' ERR

echo "============================================================"
echo " Social Frontend E2E — автоматическая настройка для macOS"
echo "============================================================"
echo

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Этот установщик предназначен только для macOS."
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "Предупреждение: ожидался Apple Silicon (M1/M2/M3/M4), но обнаружено $(uname -m)."
fi

# Переносим распакованный проект из Downloads в постоянную папку.
if [[ "$SOURCE_DIR" != "$TARGET_DIR" && "${1:-}" != "--installed" ]]; then
  mkdir -p "$HOME/Projects"

  if [[ -e "$TARGET_DIR" ]]; then
    TARGET_DIR="$HOME/Projects/${PROJECT_NAME}-$(date +%Y%m%d-%H%M%S)"
  fi

  echo "Создаю локальный проект: $TARGET_DIR"
  ditto "$SOURCE_DIR" "$TARGET_DIR"
  chmod +x "$TARGET_DIR/SETUP-MAC.command"
  exec "$TARGET_DIR/SETUP-MAC.command" --installed
fi

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew не найден. Запускаю официальный установщик Homebrew."
  echo "macOS может попросить пароль пользователя компьютера."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Устанавливаю Node.js..."
  brew install node
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Устанавливаю GitHub CLI..."
  brew install gh
fi

echo "Устанавливаю зависимости проекта..."
npm ci

echo "Устанавливаю браузеры Playwright..."
npx playwright install chromium webkit

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
fi

echo
echo "Сейчас откроется официальный вход GitHub."
echo "Пароль и код подтверждения вводятся только на странице GitHub."
echo

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  gh auth login --hostname github.com --git-protocol https --web
fi

GITHUB_LOGIN="$(gh api user --jq .login)"
GITHUB_NAME="$(gh api user --jq '.name // .login')"
REPOSITORY_NAME="$PROJECT_NAME"

if gh repo view "$GITHUB_LOGIN/$REPOSITORY_NAME" >/dev/null 2>&1; then
  REPOSITORY_NAME="${PROJECT_NAME}-$(date +%Y%m%d-%H%M%S)"
fi

if [[ ! -d .git ]]; then
  git init -b main
fi

git config user.name "$GITHUB_NAME"
git config user.email "$GITHUB_LOGIN@users.noreply.github.com"
git add .

if ! git diff --cached --quiet; then
  git commit -m "Add Playwright E2E test suite"
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Создаю приватный репозиторий $GITHUB_LOGIN/$REPOSITORY_NAME..."
  gh repo create "$REPOSITORY_NAME" \
    --private \
    --source=. \
    --remote=origin \
    --push \
    --description "Playwright E2E tests for Social Frontend"
else
  git push -u origin HEAD
fi

REPOSITORY_URL="$(gh repo view --json url --jq .url)"

echo
echo "============================================================"
echo " Готово"
echo "============================================================"
echo "Локальная папка: $PROJECT_DIR"
echo "GitHub: $REPOSITORY_URL"
echo
echo "Файл .env создан локально и не отправлен в GitHub."
echo "После заполнения .env запустите: npm test"
echo

open "$PROJECT_DIR"
open "$REPOSITORY_URL"
open -e "$PROJECT_DIR/.env"

read -r -p "Нажмите Enter, чтобы закрыть окно..." _
