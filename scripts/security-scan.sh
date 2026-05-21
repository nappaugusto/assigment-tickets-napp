#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Checking that no tracked .env files are staged for Git..."
if git ls-files --cached --others --exclude-standard |
  grep -E '(^|/)\.env(\.|$)' |
  grep -vE '(^|/)\.env\.example$' >/dev/null; then
  git ls-files --cached --others --exclude-standard |
    grep -E '(^|/)\.env(\.|$)' |
    grep -vE '(^|/)\.env\.example$'
  echo "Refusing to continue: .env files must stay out of Git." >&2
  exit 1
fi

echo "Checking frontend for secret-like VITE variables..."
if rg -n --hidden \
  -g '!node_modules' \
  -g '!dist' \
  -g '!build' \
  -g '!coverage' \
  -g '!*.lock' \
  -g '!.git' \
  'VITE_[A-Z0-9_]*(TOKEN|SECRET|KEY|PASSWORD|PASS|PWD|AUTH|JWT)|import\.meta\.env\.[A-Z0-9_]*(TOKEN|SECRET|KEY|PASSWORD|PASS|PWD|AUTH|JWT)' \
  frontend .env.example README.md; then
  echo "Secret-like frontend environment variable found. Move it to the backend." >&2
  exit 1
fi

echo "Checking repository for common hard-coded secret patterns..."
if rg -n --hidden \
  -g '!node_modules' \
  -g '!dist' \
  -g '!build' \
  -g '!coverage' \
  -g '!*.lock' \
  -g '!.git' \
  -g '!.env' \
  -g '!.env.*' \
  -g '!vendor/**' \
  -i '(AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z_]{20,}|xox[baprs]-[0-9A-Za-z-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})' \
  .; then
  echo "Possible hard-coded secret found." >&2
  exit 1
fi

echo "Security scan passed."
