#!/usr/bin/env bash
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-additv/sumo-hoppers}"
BRANCH="${PUBLISH_BRANCH:-main}"
WORKFLOW="${PUBLISH_WORKFLOW:-Deploy GitHub Pages}"
SITE_URL="${PUBLISH_SITE_URL:-https://additv.github.io/sumo-hoppers/}"
COMMIT_MESSAGE=""
SKIP_COMMIT=0

usage() {
  cat <<'USAGE'
Usage:
  scripts/publish.sh -m "Commit message"
  scripts/publish.sh --no-commit

Options:
  -m, --message TEXT  Stage all changes and commit with TEXT before publishing.
  --no-commit        Publish the current branch without committing local changes.
  -h, --help         Show this help.

Environment overrides:
  GITHUB_REPOSITORY  GitHub repo, default: additv/sumo-hoppers
  PUBLISH_BRANCH     Branch to push and deploy, default: main
  PUBLISH_WORKFLOW   Workflow name, default: Deploy GitHub Pages
  PUBLISH_SITE_URL   URL to verify, default: https://additv.github.io/sumo-hoppers/
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)
      if [[ $# -lt 2 ]]; then
        echo "Missing commit message after $1" >&2
        exit 2
      fi
      COMMIT_MESSAGE="$2"
      shift 2
      ;;
    --no-commit)
      SKIP_COMMIT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

for cmd in git gh curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd" >&2
    exit 127
  fi
done

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  echo "Expected branch '$BRANCH', but current branch is '$current_branch'." >&2
  exit 1
fi

dirty_status="$(git status --short)"
if [[ "$SKIP_COMMIT" -eq 0 ]]; then
  if [[ -z "$COMMIT_MESSAGE" ]]; then
    if [[ -n "$dirty_status" ]]; then
      echo "Working tree has changes. Pass -m \"Commit message\" to commit them, or --no-commit to publish without committing." >&2
      git status --short >&2
      exit 1
    fi
  else
    git add -A
    if git diff --cached --quiet; then
      echo "No staged changes to commit."
    else
      git commit -m "$COMMIT_MESSAGE"
    fi
  fi
elif [[ -n "$dirty_status" ]]; then
  echo "Working tree has uncommitted changes; publishing committed state only:"
  git status --short
fi

echo "Pushing $BRANCH to $REPO..."
git push origin "$BRANCH"

echo "Ensuring GitHub Pages uses workflow deployments..."
if ! gh api "repos/$REPO/pages" >/dev/null 2>&1; then
  gh api --method POST "repos/$REPO/pages" -f build_type=workflow >/dev/null
else
  build_type="$(gh api "repos/$REPO/pages" --jq '.build_type')"
  if [[ "$build_type" != "workflow" ]]; then
    gh api --method PUT "repos/$REPO/pages" -f build_type=workflow >/dev/null
  fi
fi

echo "Waiting for workflow '$WORKFLOW'..."
run_id=""
for _ in {1..20}; do
  run_id="$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
  if [[ -n "$run_id" ]]; then
    break
  fi
  sleep 3
done

if [[ -z "$run_id" ]]; then
  echo "Could not find a workflow run for '$WORKFLOW' on '$BRANCH'." >&2
  exit 1
fi

gh run watch "$run_id" --repo "$REPO" --exit-status

echo "Verifying $SITE_URL..."
curl -fsSI "$SITE_URL" >/dev/null
echo "Published: $SITE_URL"
