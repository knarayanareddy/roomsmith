#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KOTLINC="${KOTLINC:-$ROOT/node_modules/kotlin-compiler/bin/kotlinc}"
if [[ ! -x "$KOTLINC" ]]; then
  echo "Kotlin compiler not found. Run make bootstrap or set KOTLINC." >&2
  exit 1
fi
if [[ -n "${JAVA_HOME:-}" ]]; then
  JAVA="$JAVA_HOME/bin/java"
else
  JAVA="$(command -v java || true)"
fi
if [[ -z "$JAVA" || ! -x "$JAVA" ]]; then
  echo "JDK/JRE 17 is required for the pure Kotlin domain harness. Android SDK is separately required for apps." >&2
  exit 1
fi

MAIN_SOURCES=()
while IFS= read -r line; do
  [[ -n "$line" ]] && MAIN_SOURCES+=("$line")
done < <(find "$ROOT/packages/puzzle-engine/src/main/kotlin" -name '*.kt' | sort)

TEST_SOURCES=()
while IFS= read -r line; do
  [[ -n "$line" ]] && TEST_SOURCES+=("$line")
done < <(find "$ROOT/packages/puzzle-engine/src/test/kotlin" -name '*.kt' | sort)
mkdir -p "$ROOT/build"
COMMAND="${1:-}"
case "$COMMAND" in
  typecheck)
    "$KOTLINC" "${MAIN_SOURCES[@]}" "${TEST_SOURCES[@]}" -d "$ROOT/build/typecheck.jar"
    ;;
  build)
    "$KOTLINC" "${MAIN_SOURCES[@]}" -include-runtime -d "$ROOT/build/puzzle-engine.jar"
    ;;
  test)
    "$KOTLINC" "${MAIN_SOURCES[@]}" "${TEST_SOURCES[@]}" -include-runtime -d "$ROOT/build/puzzle-engine-tests.jar"
    "$JAVA" -Dfile.encoding=UTF-8 -cp "$ROOT/build/puzzle-engine-tests.jar" com.roomsmith.puzzle.PuzzleEngineTestSuite
    ;;
  run)
    "$KOTLINC" "${MAIN_SOURCES[@]}" -include-runtime -d "$ROOT/build/puzzle-engine.jar"
    "$JAVA" -Dfile.encoding=UTF-8 -cp "$ROOT/build/puzzle-engine.jar" com.roomsmith.puzzle.WalkingSkeleton
    ;;
  *)
    echo "Usage: $0 {typecheck|build|test|run}" >&2
    exit 2
    ;;
esac
