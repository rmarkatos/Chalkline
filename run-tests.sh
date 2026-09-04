#!/usr/bin/env bash
# Run every suite and print one line each. Any failure fails the script.
#
#   ./run-tests.sh            all of them
#   ./run-tests.sh graph      only suites whose name contains "graph"
set -uo pipefail
cd "$(dirname "$0")"
python3 build.py >/dev/null || { echo "build failed"; exit 1; }

filter="${1:-}"
bad=0
for f in test.js test-text.js test-raw.js test-parser.js test-focus.js \
         test-delims.js test-app-editor.js test-graph.js \
         test-class.js test-push.js test-persist.js test-late.js \
         test-presence.js test-notes.js test-tabs.js test-wipe.js \
         test-rules.js test-auth.js test-firebase.js test-phone.js \
         test-schema.js; do
  [ -n "$filter" ] && case "$f" in *"$filter"*) ;; *) continue;; esac
  out=$(node "$f" 2>&1)
  line=$(printf '%s' "$out" | grep -ioE "[0-9]+ passed, [0-9]+ failed|[0-9]+/[0-9]+ passed|ALL ROUND-TRIPS CLEAN" | tail -1)
  # test.js reports one line per case rather than a total
  [ -z "$line" ] && line="$(printf '%s' "$out" | grep -c '\[PASS\]') passed, $(printf '%s' "$out" | grep -c '\[FAIL\]') failed"
  case "$line" in
    *" 0 failed"*|*"ALL ROUND-TRIPS CLEAN"*) mark="ok  ";;
    # suites that report "N/N passed" are green only when the two agree,
    # so 18/18 passes and 17/18 still fails
    */*" passed")
        n=${line%%/*}; d=${line#*/}; d=${d%% *}
        if [ -n "$n" ] && [ "$n" = "$d" ]; then mark="ok  "; else mark="FAIL"; bad=1; fi;;
    *) mark="FAIL"; bad=1;;
  esac
  # a suite that printed nothing usable has fallen over
  [ -z "$line" ] && { mark="FAIL"; bad=1; line="(no result — see below)"; }
  printf '%s %-20s %s\n' "$mark" "$f" "$line"
  [ "$mark" = "FAIL" ] && printf '%s\n' "$out" | tail -20
done
echo
[ "$bad" = 0 ] && echo "all green" || echo "something failed"
exit $bad
