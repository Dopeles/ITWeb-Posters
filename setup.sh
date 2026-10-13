#!/usr/bin/env bash
# One-time setup: creates a private GitHub repo, uploads everything, stores your API key, runs a test.
# Usage (Mac/Linux): open Terminal in this folder and run:  bash setup.sh
set -e
REPO="${1:-itweb-posters}"
cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Please install $1 first: $2"; exit 1; }; }
need git "https://git-scm.com/downloads"
need gh  "https://cli.github.com  (Mac: brew install gh)"

gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https --scopes "repo,workflow"

[ -d .git ] || git init -q -b main
git add -A
git -c user.name="poster-setup" -c user.email="poster-setup@users.noreply.github.com" commit -qm "Poster automation" || true

if gh repo view "$REPO" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "$(gh repo view "$REPO" --json url -q .url).git"
  git push -u origin main --force
else
  gh repo create "$REPO" --private --source . --push
fi

read -r -s -p "Paste your Anthropic API key (starts sk-ant-), or press Enter to skip: " KEY; echo
[ -n "$KEY" ] && printf '%s' "$KEY" | gh secret set ANTHROPIC_API_KEY --repo "$(gh repo view "$REPO" --json nameWithOwner -q .nameWithOwner)"

sleep 3
gh workflow run daily-posters.yml --repo "$(gh repo view "$REPO" --json nameWithOwner -q .nameWithOwner)"
echo
echo "Done. Test run started. Watch it here:"
echo "$(gh repo view "$REPO" --json url -q .url)/actions"
echo "From now on it runs by itself every weekday at 13:05 SA time."
