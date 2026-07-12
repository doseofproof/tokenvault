#!/usr/bin/env bash
# Headless nightly loop payload. Runs in GitHub Actions (see .github/workflows/loop.yml)
# but works locally too: ANTHROPIC_API_KEY=... ./run.sh
set -euo pipefail

cd "$(dirname "$0")"

# Canary gate: never run the loop over a drifted model.
if [ -f DRIFT ]; then
  echo "DRIFT file present — loop halted pending human review." >&2
  exit 1
fi

# Workspace must be green before and after any agent work.
npm ci
npm test

# Headless agent pass: pick up open items from goals.md, smallest first.
# No open items -> the agent reports and exits without changes.
if ! command -v claude >/dev/null 2>&1; then
  npm install -g @anthropic-ai/claude-code
fi

claude -p \
  --model "${ANTHROPIC_MODEL:-claude-fable-5}" \
  --permission-mode acceptEdits \
  "You are running unattended in CI for the tokenvault repo (cwd). Read goals.md.
If every item is marked DONE, print 'loop: no open items' and stop — do not invent work.
Otherwise implement ONLY the single smallest open item, run 'npm test' until green,
update goals.md, and commit with a conventional message. Never push; CI pushes."

# Verify the agent left the tree green, then publish whatever it committed.
npm test
git push origin HEAD:main
