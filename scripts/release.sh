#!/usr/bin/env bash
# Release script — bumps version, builds all platform artifacts, and publishes a GitHub release.
# Usage: ./scripts/release.sh [--dry-run] <version>
# Example: ./scripts/release.sh v1.0.0
#          ./scripts/release.sh --dry-run v1.0.0

set -euo pipefail

# ── Minimal styling for print_help (full palette declared after arg parsing) ─
BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
WHITE='\033[0;97m'
YELLOW='\033[0;33m'
RESET='\033[0m'

print_help() {
  local W=30   # description indent width (must match flag-column width below)
  echo -e "
${BOLD}${WHITE}USAGE${RESET}
  ${CYAN}./scripts/release.sh${RESET} [options] <version>

${BOLD}${WHITE}ARGUMENTS${RESET}
  ${BOLD}<version>${RESET}
        Release version — e.g. ${CYAN}v1.2.3${RESET} or ${CYAN}1.2.3${RESET}.
        Must be >= the current package.json version. The leading ${BOLD}v${RESET} is optional.
        Omit entirely when using ${BOLD}--upload-only${RESET} (inferred from package.json).

${BOLD}${WHITE}OPTIONS${RESET}
  ${BOLD}--dry-run${RESET}  ${DIM}--simulate${RESET}
        Simulate the release without making any changes. Validates the version,
        lists each artifact that would be uploaded (with file size), and prints a
        full preview of the release notes. Nothing is written, committed, or published.

  ${BOLD}--prepare-only${RESET}
        Run Steps 0–4 only (prereqs, version bump, build, commit + push) then exit
        before creating or uploading the GitHub release. Inspect ${CYAN}dist/${RESET} artifacts,
        sign them if needed, then publish with ${BOLD}--upload-only${RESET}.
        Stacks with ${BOLD}--seq${RESET}, ${BOLD}--install-prereqs${RESET}, and ${BOLD}--dry-run${RESET}.

  ${BOLD}--upload-only${RESET}
        Skip Steps 0–4 and jump straight to Step 5 (create GitHub release + upload
        ${CYAN}dist/${RESET} artifacts). Version is read from package.json — no argument needed.
        Use after ${BOLD}--prepare-only${RESET}, or when artifacts were built externally (e.g. CI).
        Only ${BOLD}gh${RESET} CLI is required — build tools are not checked.
        Stacks with ${BOLD}--re-release${RESET} and ${BOLD}--dry-run${RESET}.

  ${BOLD}--re-release${RESET}
        Re-publish an already-released version with rebuilt artifacts and refreshed
        release notes. Deletes the existing GitHub release and git tag, then
        re-creates them pinned to HEAD. Generates the changelog against the previous
        good tag (skipping the version being re-released). Use this to recover from
        a broken release of the same version.

  ${BOLD}--seq${RESET}
        Build platforms sequentially instead of in parallel. Slower overall, but
        produces clean non-interleaved output — useful for debugging build failures.
        External Windows signing does not require this; signing jobs are serialized separately.

  ${BOLD}--debug-skip-clean-tree-check${RESET}
        Debug-only escape hatch for release/signing validation. The script still
        reports dirty files and unpushed commits, but does not fail the release
        at the clean working-tree gate. Do not use for production releases.

  ${BOLD}--install-prereqs${RESET}  ${DIM}--install-deps${RESET}
        Auto-install any missing build/release prerequisites (Homebrew on macOS,
        apt/dnf/pacman on Linux, winget/choco on Windows). Combine with ${BOLD}--dry-run${RESET}
        to preview the install plan only. Node major upgrades, ${BOLD}gh auth login${RESET}, and
        .deb tooling on Windows (→ WSL) are surfaced as manual steps.
        ${YELLOW}⚠${RESET}  Signing tools and env vars (CSC_LINK, WIN_CSC_LINK, APPLE_*) are NOT
           auto-installed.

  ${BOLD}--sign-script <path>${RESET}
        Optional path to an external Windows signing script. Supports absolute,
        relative, and ${BOLD}~${RESET}-based paths, resolved to an absolute path before use.
        When present and found, Windows build wrappers skip electron-builder's built-in
        Authenticode signing for direct signable files in ${CYAN}dist/win-unpacked${RESET}
        and direct final ${CYAN}dist/*.{exe,msi,msp}${RESET} artifacts,
        leaving nested helpers eligible for signtool, then hooks call the script with ${BOLD}--run${RESET},
        an auto-populated source folder (${CYAN}dist/win-unpacked${RESET} after resource editing,
        or final artifact folder), and the official product name (${BOLD}ArcGIS Velocity Simulator${RESET}).
        If omitted or missing,
        the build falls back to the current electron-builder signing/unsigned behavior.
        Each external signing invocation uses a shared lock so the parallel build can remain enabled.
        Output streams live in the nested signing log. Stdin is closed so prompts fail instead
        of hanging. The wrapper prints heartbeat progress every 30 seconds while sign.sh is quiet and uses
        ${BOLD}--sign-timeout-minutes${RESET} plus a 5-minute watchdog buffer (${BOLD}VELOCITY_SIGN_TIMEOUT_MS=0${RESET} disables it).

  ${BOLD}--sign-share-dir <UNC>${RESET}
        Optional share directory passed to the external signing script as ${BOLD}--share-dir${RESET}.
        Only used when ${BOLD}--sign-script${RESET} is provided and found.

  ${BOLD}--sign-product-names <names>${RESET}
        Optional value passed to the external signing script as ${BOLD}--product-names${RESET}.
        Defaults to the official app product name (${BOLD}ArcGIS Velocity Simulator${RESET}).
        Use comma-separated names when signing multiple source directories.

  ${BOLD}--sign-timeout-minutes <minutes>${RESET}
        External signing script timeout passed to ${BOLD}sign.sh${RESET} as ${BOLD}--timeout-minutes${RESET}.
        Default: ${BOLD}20${RESET}. Must be a positive whole number of minutes.

  ${BOLD}--sign-progress-interval-ms <ms>${RESET}
        How long the external signing process must be silent before a "Still waiting"
        heartbeat line is printed (in milliseconds). Also sets the minimum interval
        between consecutive heartbeat lines, so you see at most one line per interval
        even if the process stays quiet indefinitely.
        Default: ${BOLD}30000${RESET} (30 s). Set to ${BOLD}0${RESET} to disable heartbeat logging entirely.
        Only used when ${BOLD}--sign-script${RESET} is provided and the external process is running.

  ${BOLD}--sign-poll-interval-ms <ms>${RESET}
        How often (in milliseconds) the wrapper checks whether the silence threshold
        has been reached. This controls the ${DIM}maximum latency${RESET} before a heartbeat line
        appears once 30 s of silence has elapsed — it does ${DIM}NOT${RESET} affect how often
        lines are printed (that is controlled by ${BOLD}--sign-progress-interval-ms${RESET}).
        Default: ${BOLD}5000${RESET} (5 s). Clamped to ≤ ${BOLD}--sign-progress-interval-ms${RESET} automatically.
        Only used when ${BOLD}--sign-script${RESET} is provided and the external process is running.

  ${BOLD}--help${RESET}
        Show this help message and exit.

  ${BOLD}--list${RESET}
        List all published GitHub releases for this repository and exit.
        Requires ${BOLD}gh${RESET} CLI to be installed and authenticated.
        Outputs a table with columns: ${BOLD}TAG · DATE · STATUS · URL${RESET}.
        STATUS is colour-coded: ${GREEN}● latest${RESET}  ${YELLOW}◐ pre${RESET}  ${DIM}○ draft${RESET}.
        Pair with ${BOLD}--limit${RESET} ${DIM}<n>${RESET} to control how many releases are shown ${DIM}(default: 10)${RESET}.

  ${BOLD}--limit${RESET}  ${DIM}<n>${RESET}
        Maximum number of releases to show with ${BOLD}--list${RESET}. Default: ${DIM}10${RESET}.

${BOLD}${WHITE}TYPO SUGGESTIONS${RESET}
  Unknown long flags use ${BOLD}Levenshtein edit distance${RESET} to suggest the closest valid
  option when the typo is near enough. Unlike character-overlap scoring, edit
  distance accounts for order plus inserted, deleted, and substituted characters.
  Example: ${CYAN}--prepareonly${RESET} → ${CYAN}--prepare-only${RESET}.

  Options considered:
    • Exact allowlist validation — still used to decide if a flag is valid.
    • Character overlap — simple, but ignores order and can over-score shared letters.
    • Damerau-Levenshtein — handles adjacent swaps as one edit, but adds complexity.
    • Levenshtein — selected for suggestions: deterministic, dependency-free, and
      good for missing hyphens, omitted characters, extra characters, and substitutions.

${BOLD}${WHITE}RELEASE PIPELINE${RESET}
  Phase 1  Check build prerequisites
  Phase 2  Verify clean working tree
  Phase 3  Validate requested version (blocks downgrades)
  Phase 4  Bump version in package.json
  Phase 5  Build all platform packages  ${DIM}(parallel by default; signing jobs are locked)${RESET}
  Phase 6  Commit + push the version bump
  Phase 7  Create GitHub release + upload dist/ artifacts

  ${DIM}Banners show the selected-mode count, for example: VELOCITY RELEASE Step 3/7.${RESET}
  ${DIM}--prepare-only  stops after Phase 6  (build + commit, no GitHub upload)${RESET}
  ${DIM}--upload-only   still shows skipped prep phases, then runs Phase 7 upload only${RESET}

${BOLD}${WHITE}PREREQUISITES${RESET}
  • Run from the repository root
  • ${BOLD}node${RESET} ≥ 18, ${BOLD}npm${RESET}, and ${BOLD}node_modules${RESET} present  ${DIM}(npm install)${RESET}
  • ${BOLD}gh${RESET} (GitHub CLI) installed and authenticated  ${DIM}(gh auth login)${RESET}
  • ${BOLD}git${RESET} configured with push access
  • ${BOLD}dpkg${RESET}, ${BOLD}fakeroot${RESET}, GNU ${BOLD}ar${RESET}  ${DIM}(macOS .deb builds — brew install dpkg fakeroot binutils)${RESET}

${BOLD}${WHITE}EXAMPLES${RESET}
  ${DIM}# Full release — does everything in one command${RESET}
  ${CYAN}./scripts/release.sh v1.2.3${RESET}

  ${DIM}# Same, without the v prefix${RESET}
  ${CYAN}./scripts/release.sh 1.2.3${RESET}

  ${DIM}# Preview the full release without making any changes (recommended first step)${RESET}
  ${CYAN}./scripts/release.sh --dry-run v1.2.3${RESET}

  ${DIM}# Two-phase: build + commit now, review artifacts, upload later${RESET}
  ${CYAN}./scripts/release.sh --prepare-only v1.2.3${RESET}
  ${CYAN}./scripts/release.sh --upload-only${RESET}

  ${DIM}# Two-phase with sequential build (clean output, useful for debugging)${RESET}
  ${CYAN}./scripts/release.sh --prepare-only --seq v1.2.3${RESET}
  ${CYAN}./scripts/release.sh --upload-only${RESET}

  ${DIM}# Upload-only for externally produced artifacts (e.g. from CI)${RESET}
  ${CYAN}./scripts/release.sh --upload-only${RESET}

  ${DIM}# Recover from a broken release — delete + rebuild + re-upload${RESET}
  ${CYAN}./scripts/release.sh --re-release v1.2.3${RESET}

  ${DIM}# Re-upload only (skip rebuild — reuse existing dist/ artifacts)${RESET}
  ${CYAN}./scripts/release.sh --upload-only --re-release${RESET}

  ${DIM}# Sequential build (clean output, slower)${RESET}
  ${CYAN}./scripts/release.sh --seq v1.2.3${RESET}

  ${DIM}# Auto-install missing prerequisites, then release${RESET}
  ${CYAN}./scripts/release.sh --install-prereqs v1.2.3${RESET}

  ${DIM}# Preview prereq install plan only (no install, no release)${RESET}
  ${CYAN}./scripts/release.sh --install-prereqs --dry-run v1.2.3${RESET}

  ${DIM}# Release with an external Windows signing script (paths can be absolute, relative, or ~-based)${RESET}
  ${CYAN}./scripts/release.sh v1.2.3 \\
    --sign-script ~/signing/sign.sh \\
    --sign-share-dir '\\\\\\\\storm\upload\DigitalSign\Velocity' \\
    --sign-timeout-minutes 30 \\
    --sign-product-names "ArcGIS Velocity Simulator"${RESET}

  ${DIM}# Preview release + external signing; invokes sign.sh with its own --dry-run mode${RESET}
  ${CYAN}./scripts/release.sh --dry-run v1.2.3 \\
    --sign-script ../../../signing/sign.sh \\
    --sign-share-dir '\\\\storm\upload\DigitalSign\Velocity'${RESET}

  ${DIM}# List all published releases${RESET}
  ${CYAN}./scripts/release.sh --list${RESET}

  ${DIM}# List the 5 most recent releases${RESET}
  ${CYAN}./scripts/release.sh --list --limit 5${RESET}
"
}

# ── Early help / no-arg handling ─────────────────────────────────────────────
if [[ $# -eq 0 ]]; then
  echo -e "\n  ${YELLOW}⚠${RESET}  No arguments provided.\n"
  print_help
  exit 1
fi
for arg in "$@"; do
  [[ "$arg" == "--help" || "$arg" == "-h" ]] && print_help && exit 0
done

# ── Full styling palette ─────────────────────────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
WHITE='\033[0;97m'
RESET='\033[0m'

SCRIPT_START=$(date +%s)
RELEASE_STEP_INDEX=0

release_step_total() {
  if [[ "${PREPARE_ONLY:-false}" == true ]]; then
    echo 6
  else
    echo 7
  fi
}

release_step_icon() {
  local msg="$1"
  case "$msg" in
    *prerequisite*) echo "🧰" ;;
    *working\ tree*) echo "🌿" ;;
    *version*) echo "🏷️" ;;
    *build*|*Build*|*package*|*Package*) echo "📦" ;;
    *commit*|*Commit*) echo "🔖" ;;
    *GitHub*|*release*|*Release*) echo "🚀" ;;
    *) echo "▶" ;;
  esac
}

banner() {
  local _legacy_step="$1" msg="$2"
  RELEASE_STEP_INDEX=$(( RELEASE_STEP_INDEX + 1 ))
  local total
  total=$(release_step_total)
  local icon
  icon=$(release_step_icon "$msg")
  local tag=""
  [[ "$DRY_RUN"          == true ]] && tag="${tag} ${BOLD}${YELLOW}[dry run]${RESET}${BOLD}${CYAN}"
  [[ "$RERELEASE"        == true ]] && tag="${tag} ${BOLD}${RED}[re-release]${RESET}${BOLD}${CYAN}"
  [[ "$SEQ"              == true ]] && tag="${tag} ${BOLD}${CYAN}[seq]${RESET}${BOLD}${CYAN}"
  [[ "$PREPARE_ONLY"     == true ]] && tag="${tag} ${BOLD}${CYAN}[prepare-only]${RESET}${BOLD}${CYAN}"
  [[ "$UPLOAD_ONLY"      == true ]] && tag="${tag} ${BOLD}${GREEN}[upload-only]${RESET}${BOLD}${CYAN}"
  [[ "$INSTALL_PREREQS"  == true ]] && tag="${tag} ${BOLD}${GREEN}[install-prereqs]${RESET}${BOLD}${CYAN}"
  [[ "$DEBUG_SKIP_CLEAN_TREE_CHECK" == true ]] && tag="${tag} ${BOLD}${YELLOW}[debug-skip-clean-tree-check]${RESET}${BOLD}${CYAN}"
  echo ""
  echo -e "${BOLD}${CYAN}┌─ 🚀 VELOCITY RELEASE Step ${RELEASE_STEP_INDEX}/${total}${tag} ─────────────────────────────────────────${RESET}"
  echo -e "${BOLD}${CYAN}│${RESET}  ${icon}  ${WHITE}${msg}${RESET}"
  echo -e "${BOLD}${CYAN}└────────────────────────────────────────────────────────────────${RESET}"
}

info()    { echo -e "  ${CYAN}ℹ${RESET}  $*"; }
success() { echo -e "  ${GREEN}✔${RESET}  $*"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
fail()    { echo -e "\n  ${RED}${BOLD}✖  ERROR:${RESET}  $*\n" >&2; exit 1; }
dryrun()  { echo -e "  ${YELLOW}${DIM}◌  [dry run]${RESET}  ${DIM}$*${RESET}"; }

elapsed() {
  local s=$(( $(date +%s) - SCRIPT_START ))
  printf "%dm %02ds" $(( s / 60 )) $(( s % 60 ))
}

# run <description> <cmd> [args...]
# In dry-run mode: prints the command instead of executing it.
run() {
  local desc="$1"; shift
  if [[ "$DRY_RUN" == true ]]; then
    dryrun "${desc}: $*"
  else
    "$@"
  fi
}


# ── Semver comparison ────────────────────────────────────────────────────────
# Returns 0 (true) if $1 < $2
semver_lt() {
  local IFS='.'
  local -a a=($1) b=($2)
  for i in 0 1 2; do
    local av=${a[$i]:-0} bv=${b[$i]:-0}
    (( av < bv )) && return 0
    (( av > bv )) && return 1
  done
  return 1  # equal — not less than
}

# ── Argument parsing ─────────────────────────────────────────────────────────
DRY_RUN=false
RERELEASE=false
SEQ=false
INSTALL_PREREQS=false
PREPARE_ONLY=false
UPLOAD_ONLY=false
DEBUG_SKIP_CLEAN_TREE_CHECK=false
LIST=false
LIST_LIMIT=10
VERSION=""
SIGN_SCRIPT=""
SIGN_SHARE_DIR=""
SIGN_PRODUCT_NAMES=""
SIGN_TIMEOUT_MINUTES=""
SIGN_PROGRESS_INTERVAL_MS=""
SIGN_POLL_INTERVAL_MS=""

# levenshtein_distance <left> <right> — minimum insert/delete/substitute edits.
levenshtein_distance() {
  local left="$1" right="$2"
  local left_len=${#left} right_len=${#right}
  local -a previous current
  local i j cost deletion insertion substitution min

  for (( j=0; j<=right_len; j++ )); do previous[$j]=$j; done

  for (( i=1; i<=left_len; i++ )); do
    current[0]=$i
    for (( j=1; j<=right_len; j++ )); do
      if [[ "${left:i-1:1}" == "${right:j-1:1}" ]]; then cost=0; else cost=1; fi
      deletion=$(( previous[j] + 1 ))
      insertion=$(( current[j-1] + 1 ))
      substitution=$(( previous[j-1] + cost ))
      min=$deletion
      (( insertion < min )) && min=$insertion
      (( substitution < min )) && min=$substitution
      current[$j]=$min
    done
    previous=("${current[@]}")
  done

  echo "${previous[$right_len]}"
}

suggestion_max_distance() {
  local input="$1" candidate="$2" length=${#input}
  (( ${#candidate} > length )) && length=${#candidate}
  if (( length <= 4 )); then echo 1
  elif (( length <= 8 )); then echo 2
  elif (( length <= 14 )); then echo 3
  else echo 4
  fi
}

# closest_flag <unknown> — prints a valid flag when Levenshtein distance is small.
closest_flag() {
  local input="${1#--}"; input="${input#-}"
  input="$(printf '%s' "$input" | tr '[:upper:]' '[:lower:]')"
  local best_flag="" best_distance=999
  local known=(
    "--dry-run" "--simulate" "--re-release" "--seq"
    "--prepare-only" "--upload-only" "--install-prereqs" "--install-deps"
    "--debug-skip-clean-tree-check"
    "--sign-script" "--sign-share-dir" "--sign-product-names" "--sign-timeout-minutes"
    "--sign-progress-interval-ms" "--sign-poll-interval-ms"
    "--list" "--limit" "--help"
  )
  for flag in "${known[@]}"; do
    local f="${flag#--}"
    local distance threshold
    distance=$(levenshtein_distance "$input" "$f")
    threshold=$(suggestion_max_distance "$input" "$f")
    if (( distance <= threshold && distance < best_distance )); then
      best_distance=$distance
      best_flag=$flag
    fi
  done
  echo "$best_flag"
}

while [[ $# -gt 0 ]]; do
  arg="$1"
  case "$arg" in
    --dry-run|--simulate|-s)             DRY_RUN=true; shift ;;
    --re-release|-R)                     RERELEASE=true; shift ;;
    --seq|-S)                            SEQ=true; shift ;;
    --prepare-only|-p)                   PREPARE_ONLY=true; shift ;;
    --upload-only|-u)                    UPLOAD_ONLY=true; shift ;;
    --debug-skip-clean-tree-check)       DEBUG_SKIP_CLEAN_TREE_CHECK=true; shift ;;
    --install-prereqs|--install-deps|-i) INSTALL_PREREQS=true; shift ;;
    --list|-l)                           LIST=true; shift ;;
    --limit=*)                           LIST_LIMIT="${arg#--limit=}"; shift ;;
    --limit)                             [[ $# -ge 2 ]] || fail "--limit requires a value"; LIST_LIMIT="$2"; shift 2 ;;
    --sign-script=*)                     SIGN_SCRIPT="${arg#--sign-script=}"; shift ;;
    --sign-script|-x)                    [[ $# -ge 2 ]] || fail "${arg} requires a value"; SIGN_SCRIPT="$2"; shift 2 ;;
    --sign-share-dir=*)                  SIGN_SHARE_DIR="${arg#--sign-share-dir=}"; shift ;;
    --sign-share-dir|-d)                 [[ $# -ge 2 ]] || fail "${arg} requires a value"; SIGN_SHARE_DIR="$2"; shift 2 ;;
    --sign-product-names=*)              SIGN_PRODUCT_NAMES="${arg#--sign-product-names=}"; shift ;;
    --sign-product-names)                [[ $# -ge 2 ]] || fail "${arg} requires a value"; SIGN_PRODUCT_NAMES="$2"; shift 2 ;;
    --sign-timeout-minutes=*)            SIGN_TIMEOUT_MINUTES="${arg#--sign-timeout-minutes=}"; shift ;;
    --sign-timeout-minutes)              [[ $# -ge 2 ]] || fail "${arg} requires a value"; SIGN_TIMEOUT_MINUTES="$2"; shift 2 ;;
    --sign-progress-interval-ms=*)       SIGN_PROGRESS_INTERVAL_MS="${arg#--sign-progress-interval-ms=}"; shift ;;
    --sign-progress-interval-ms)         [[ $# -ge 2 ]] || fail "${arg} requires a value"; SIGN_PROGRESS_INTERVAL_MS="$2"; shift 2 ;;
    --sign-poll-interval-ms=*)           SIGN_POLL_INTERVAL_MS="${arg#--sign-poll-interval-ms=}"; shift ;;
    --sign-poll-interval-ms)             [[ $# -ge 2 ]] || fail "${arg} requires a value"; SIGN_POLL_INTERVAL_MS="$2"; shift 2 ;;
    --*)
      # Unknown long flag — suggest the closest known one when edit distance is small
      suggestion=$(closest_flag "$arg")
      echo -e "\n  ${RED}${BOLD}✖  ERROR:${RESET}  Unrecognized option: ${BOLD}${arg}${RESET}" >&2
      if [[ -n "$suggestion" ]]; then
        echo -e "     Did you mean ${BOLD}${suggestion}${RESET}?" >&2
        echo -e "     Run ${BOLD}./scripts/release.sh --help${RESET} to see available options.\n" >&2
      else
        echo -e "     Run ${BOLD}./scripts/release.sh --help${RESET} to see available options.\n" >&2
      fi
      exit 1
      ;;
    -[a-zA-Z]*)
      # Unknown short flag
      echo -e "\n  ${RED}${BOLD}✖  ERROR:${RESET}  Unrecognized option: ${BOLD}${arg}${RESET}" >&2
      echo -e "     Run ${BOLD}./scripts/release.sh --help${RESET} to see available options.\n" >&2
      exit 1
      ;;
    *)
      VERSION="$arg"; shift
      ;;
  esac
done

# ── --list: show published releases and exit ─────────────────────────────────
if [[ "$LIST" == true ]]; then
  APP_NAME=$(node -p "require('./package.json').productName" 2>/dev/null || echo "")
  CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
  echo ""
  echo -e "${BOLD}${WHITE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}${WHITE}  🏷   ${APP_NAME}  —  Published Releases${RESET}"
  echo -e "${BOLD}${WHITE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  if ! command -v gh &>/dev/null; then
    fail "gh CLI is not installed.\n     Install with: ${CYAN}brew install gh${RESET}"
  fi
  if ! gh auth status &>/dev/null 2>&1; then
    fail "gh CLI is not authenticated.\n     Run: ${CYAN}gh auth login${RESET}"
  fi
  if gh release list --limit 1 --json tagName &>/dev/null 2>&1; then
    REPO_URL=$(gh repo view --json url -q .url 2>/dev/null || echo "https://github.com")
    echo -e "  ${BOLD}${WHITE}TAG          DATE        STATUS    URL${RESET}"
    echo -e "  ${DIM}───────────  ──────────  ────────  ──────────────────────────────────────────────────────────${RESET}"
    gh release list --limit "${LIST_LIMIT}" \
      --json tagName,publishedAt,isDraft,isPrerelease \
      --jq '.[] | [
        .tagName,
        (if .publishedAt != "" and .publishedAt != null then (.publishedAt | split("T")[0]) else "—" end),
        (if .isDraft then "draft" elif .isPrerelease then "pre" else "latest" end)
      ] | @tsv' \
    | while IFS=$'\t' read -r tag date status; do
        case "$status" in
          latest) label="${GREEN}${BOLD}● latest${RESET}" ;;
          pre)    label="${YELLOW}${BOLD}◐ pre   ${RESET}" ;;
          draft)  label="${DIM}○ draft ${RESET}" ;;
          *)      label="        " ;;
        esac
        printf -v tagpad  "%-11s" "$tag"
        printf -v datepad "%-10s" "$date"
        url="${REPO_URL}/releases/tag/${tag}"
        echo -e "  ${BOLD}${tagpad}${RESET}  ${DIM}${datepad}${RESET}  ${label}  ${CYAN}${url}${RESET}"
      done
  else
    gh release list --limit "${LIST_LIMIT}"
  fi
  echo ""
  if [[ -n "$CURRENT_VERSION" ]]; then
    echo -e "  ${DIM}local package.json${RESET}  →  ${BOLD}v${CURRENT_VERSION}${RESET}"
  fi
  echo ""
  exit 0
fi

# --upload-only can infer the version from package.json
if [[ -z "$VERSION" && "$UPLOAD_ONLY" == true ]]; then
  VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
  [[ -n "$VERSION" ]] && VERSION="v${VERSION#v}"
fi

if [[ -z "$VERSION" ]]; then
  fail "Version argument is required.\n     Usage: $0 [--dry-run] <version>  (e.g. $0 v1.0.0)\n     Exception: --upload-only can infer the version from package.json."
fi

# Normalise: ensure leading 'v'
[[ "$VERSION" != v* ]] && VERSION="v${VERSION}"
VERSION_BARE="${VERSION#v}"   # strip 'v' for package.json / semver math

if [[ -n "$SIGN_SCRIPT" ]]; then
  SIGN_SCRIPT=$(node -e 'const { resolveSignScriptPath } = require("./scripts/sign-options"); process.stdout.write(resolveSignScriptPath(process.argv[1]));' "$SIGN_SCRIPT")
fi
if [[ -n "$SIGN_TIMEOUT_MINUTES" && ! "$SIGN_TIMEOUT_MINUTES" =~ ^[1-9][0-9]*$ ]]; then
  fail "--sign-timeout-minutes must be a positive whole number of minutes."
fi

# ── Header ──────────────────────────────────────────────────────────────────
APP_NAME=$(node -p "require('./package.json').productName")
echo ""
echo -e "${BOLD}${WHITE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}${WHITE}  🚀  ${APP_NAME}  —  Release ${VERSION}${RESET}"
if [[ "$DRY_RUN" == true ]]; then
  echo -e "${BOLD}${YELLOW}  ⚠   DRY RUN — no files will be written, no commits made, no release published${RESET}"
fi
if [[ "$RERELEASE" == true ]]; then
  echo -e "${BOLD}${RED}  ⚠   RE-RELEASE — existing release and tag will be deleted and re-created${RESET}"
fi
if [[ "$SEQ" == true ]]; then
  echo -e "${BOLD}${CYAN}  ⓘ   SEQ — platforms will build sequentially (slower, clean output)${RESET}"
fi
if [[ "$PREPARE_ONLY" == true ]]; then
  echo -e "${BOLD}${CYAN}  ⓘ   PREPARE-ONLY — will stop after Step 4 (build + commit); skipping GitHub upload${RESET}"
fi
if [[ "$UPLOAD_ONLY" == true ]]; then
  echo -e "${BOLD}${GREEN}  ⓘ   UPLOAD-ONLY — skipping build; will publish existing dist/ artifacts to GitHub${RESET}"
fi
if [[ "$INSTALL_PREREQS" == true ]]; then
  echo -e "${BOLD}${GREEN}  ⓘ   INSTALL-PREREQS — missing build/release tools will be auto-installed${RESET}"
fi
if [[ "$DEBUG_SKIP_CLEAN_TREE_CHECK" == true ]]; then
  echo -e "${BOLD}${YELLOW}  ⚠   DEBUG — clean working-tree enforcement is disabled${RESET}"
  echo -e "${BOLD}${YELLOW}      Use only for local release/signing validation; production releases should be clean.${RESET}"
fi
if [[ -n "$SIGN_SCRIPT" ]]; then
  echo -e "${BOLD}${CYAN}  ⓘ   SIGN-SCRIPT — external Windows signing requested: ${SIGN_SCRIPT}${RESET}"
  [[ -n "$SIGN_SHARE_DIR" ]] && echo -e "${BOLD}${CYAN}      SIGN-SHARE — ${SIGN_SHARE_DIR}${RESET}"
  [[ -n "$SIGN_PRODUCT_NAMES" ]] && echo -e "${BOLD}${CYAN}      SIGN-PRODUCT-NAMES — ${SIGN_PRODUCT_NAMES}${RESET}"
  echo -e "${BOLD}${CYAN}      SIGN-TIMEOUT — sign.sh --timeout-minutes ${SIGN_TIMEOUT_MINUTES:-20}${RESET}"
fi
echo -e "${BOLD}${WHITE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# ── Mutual exclusivity guard ─────────────────────────────────────────────────
if [[ "$PREPARE_ONLY" == true && "$UPLOAD_ONLY" == true ]]; then
  fail "--prepare-only and --upload-only are mutually exclusive.\n     Use one or the other, or neither (to run the full pipeline)."
fi

# ── Step 0: Build prerequisites ──────────────────────────────────────────────
# Skipped entirely when --upload-only is set (build tools are not needed).
if [[ "$UPLOAD_ONLY" == true ]]; then
  banner 0 "Skipping build prerequisites (--upload-only)"
  info "Build tools not required — only gh CLI is needed for upload."
else
  banner 0 "Checking build prerequisites"

  if [[ "$INSTALL_PREREQS" == true ]]; then
    INSTALL_ARGS=(--release)
    [[ "$DRY_RUN" == true ]] && INSTALL_ARGS+=(--dry-run)
    if ! node scripts/install-prereqs.js "${INSTALL_ARGS[@]}"; then
      fail "Prerequisites missing. Install the listed tools and re-run."
    fi
  else
    if ! node scripts/check-build-prereqs.js --release; then
      fail "Prerequisites missing. Install the listed tools and re-run.\n     Tip: re-run with ${BOLD}--install-prereqs${RESET} to auto-install where possible."
    fi
  fi
fi

# ── Step 0.5: Working tree must be clean ─────────────────────────────────────
# Block the release if there are uncommitted changes (other than package.json,
# which the script itself may modify) or unpushed commits — a release should
# always reflect what's on the remote and be reproducible from the published tag.
# Dry runs warn and continue so changes can be previewed before committing.
# --debug-skip-clean-tree-check also warns and continues for local release/signing debugging only.
# Skipped when --upload-only is set (artifacts already built, tree state irrelevant).
if [[ "$UPLOAD_ONLY" == true ]]; then
  banner 0 "Skipping working tree check (--upload-only)"
  info "Tree cleanliness is not enforced when uploading pre-built artifacts."
  GIT_HASH=$(git rev-parse --short HEAD)
else
  banner 0 "Verifying clean working tree"

  WORKING_TREE_OK=true

  # 1) Uncommitted changes (excluding package.json, which Step 2 may bump)
  DIRTY_FILES=$(git status --porcelain | awk '{print $2}' | grep -v '^package\.json$' || true)
  if [[ -n "$DIRTY_FILES" ]]; then
    WORKING_TREE_OK=false
    warn "Uncommitted changes detected:"
    echo "${DIRTY_FILES}" | sed 's/^/       • /'
  fi

  # 2) Unpushed commits on the current branch
  UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo "")
  if [[ -z "$UPSTREAM" ]]; then
    WORKING_TREE_OK=false
    warn "Current branch has no upstream — cannot verify it's pushed."
  else
    AHEAD=$(git rev-list --count "${UPSTREAM}..HEAD" 2>/dev/null || echo "0")
    if [[ "${AHEAD}" -gt 0 ]]; then
      WORKING_TREE_OK=false
      warn "${AHEAD} unpushed commit(s) on the current branch:"
      git log "${UPSTREAM}..HEAD" --pretty=format:"       • %h %s" | sed -e 's/$//'
      echo ""
    fi
  fi

  if [[ "$WORKING_TREE_OK" != true ]]; then
    if [[ "$DRY_RUN" == true ]]; then
      warn "Working tree is not clean. Dry-run will continue, but a real release requires a clean tree.\n     Commit & push your changes before running without --dry-run."
    elif [[ "$DEBUG_SKIP_CLEAN_TREE_CHECK" == true ]]; then
      warn "Working tree is not clean. Continuing because --debug-skip-clean-tree-check was provided.\n     Use this only for local release/signing validation; production releases should be clean."
    else
      fail "Working tree must be clean before releasing.\n     Commit & push your changes, then re-run."
    fi
  else
    success "Working tree is clean and up to date with ${UPSTREAM}"
  fi
fi

# ── Step 1: Version gate ─────────────────────────────────────────────────────
if [[ "$UPLOAD_ONLY" == true ]]; then
  banner 1 "Skipping version gate (--upload-only)"
  info "Using version from package.json: ${BOLD}${VERSION_BARE}${RESET}"
else
  banner 1 "Validating version"

  CURRENT_VERSION=$(node -p "require('./package.json').version")
  info "Current package.json version : ${BOLD}${CURRENT_VERSION}${RESET}"
  info "Requested release version    : ${BOLD}${VERSION_BARE}${RESET}"

  if semver_lt "${VERSION_BARE}" "${CURRENT_VERSION}"; then
    fail "Requested version ${BOLD}${VERSION}${RESET} is lower than the current package.json version ${BOLD}v${CURRENT_VERSION}${RESET}.\n     Please provide a version >= v${CURRENT_VERSION}."
  fi

  success "Version is valid"
fi

# ── Step 2: Bump package.json ────────────────────────────────────────────────
if [[ "$UPLOAD_ONLY" == true ]]; then
  banner 2 "Skipping package.json bump (--upload-only)"
  info "package.json version is already ${BOLD}${VERSION_BARE}${RESET}"
  VERSION_CHANGED=false
else
  banner 2 "Updating package.json version"

  CURRENT_VERSION=$(node -p "require('./package.json').version")
  if [[ "${VERSION_BARE}" == "${CURRENT_VERSION}" ]]; then
    warn "package.json already at ${VERSION_BARE} — no change needed"
    VERSION_CHANGED=false
  else
    if [[ "$DRY_RUN" == true ]]; then
      dryrun "package.json version would change: ${CURRENT_VERSION} → ${VERSION_BARE}"
      success "package.json version change planned: ${DIM}${CURRENT_VERSION}${RESET} → ${BOLD}${VERSION_BARE}${RESET}"
    else
      node -e "
        const fs = require('fs');
        const pkg = require('./package.json');
        pkg.version = '${VERSION_BARE}';
        fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
      "
      success "package.json version updated: ${DIM}${CURRENT_VERSION}${RESET} → ${BOLD}${VERSION_BARE}${RESET}"
    fi
    VERSION_CHANGED=true
  fi
fi

# ── Step 3: Build ────────────────────────────────────────────────────────────
if [[ "$UPLOAD_ONLY" == true ]]; then
  banner 3 "Skipping build (--upload-only)"
  info "Using existing artifacts in dist/"
else
  banner 3 "Building platform packages"

  if [[ "$SEQ" == true ]]; then
    BUILD_SCRIPT="package:seq:clean"
  else
    BUILD_SCRIPT="package:all:clean"
  fi
  info "Running: npm run ${BUILD_SCRIPT}"
  if [[ -n "$SIGN_SCRIPT" ]]; then
    export VELOCITY_SIGN_SCRIPT="$SIGN_SCRIPT"
    export VELOCITY_SIGN_TIMEOUT_MINUTES="${SIGN_TIMEOUT_MINUTES:-20}"
    [[ -n "$SIGN_SHARE_DIR" ]] && export VELOCITY_SIGN_SHARE_DIR="$SIGN_SHARE_DIR" || unset VELOCITY_SIGN_SHARE_DIR
    [[ -n "$SIGN_PRODUCT_NAMES" ]] && export VELOCITY_SIGN_PRODUCT_NAMES="$SIGN_PRODUCT_NAMES" || unset VELOCITY_SIGN_PRODUCT_NAMES
    [[ -n "$SIGN_PROGRESS_INTERVAL_MS" ]] && export VELOCITY_SIGN_PROGRESS_INTERVAL_MS="$SIGN_PROGRESS_INTERVAL_MS" || unset VELOCITY_SIGN_PROGRESS_INTERVAL_MS
    [[ -n "$SIGN_POLL_INTERVAL_MS" ]] && export VELOCITY_SIGN_POLL_INTERVAL_MS="$SIGN_POLL_INTERVAL_MS" || unset VELOCITY_SIGN_POLL_INTERVAL_MS
    info "External Windows signing: ${SIGN_SCRIPT}"
    SIGN_LOCK_DIR=$(node -e 'const { getLockDir } = require("./scripts/sign-lock"); process.stdout.write(getLockDir());')
    info "External signing lock: ${SIGN_LOCK_DIR}"
    info "External sign.sh timeout: ${VELOCITY_SIGN_TIMEOUT_MINUTES} minute(s)"
    [[ -n "$SIGN_SHARE_DIR" ]] && info "Signing share directory: ${SIGN_SHARE_DIR}"
    [[ -n "$SIGN_PRODUCT_NAMES" ]] && info "Signing product names: ${SIGN_PRODUCT_NAMES}"
    [[ -n "$SIGN_PROGRESS_INTERVAL_MS" ]] && info "Heartbeat log interval: ${SIGN_PROGRESS_INTERVAL_MS} ms"
    [[ -n "$SIGN_POLL_INTERVAL_MS" ]] && info "Heartbeat poll interval: ${SIGN_POLL_INTERVAL_MS} ms"
  else
    unset VELOCITY_SIGN_SCRIPT VELOCITY_SIGN_SHARE_DIR VELOCITY_SIGN_PRODUCT_NAMES VELOCITY_SIGN_TIMEOUT_MINUTES VELOCITY_SIGN_PROGRESS_INTERVAL_MS VELOCITY_SIGN_POLL_INTERVAL_MS
  fi
  echo ""

  BUILD_START=$(date +%s)
  run "Build" npm run "${BUILD_SCRIPT}"
  [[ "$DRY_RUN" == true && -n "$SIGN_SCRIPT" ]] && node scripts/external-sign.js --dry-run-preview
  BUILD_ELAPSED=$(( $(date +%s) - BUILD_START ))

  echo ""
  success "Build complete in ${BOLD}${BUILD_ELAPSED}s${RESET}"
fi

# ── Step 4: Commit version bump ──────────────────────────────────────────────
if [[ "$UPLOAD_ONLY" == true ]]; then
  banner 4 "Skipping version bump commit (--upload-only)"
  GIT_HASH=$(git rev-parse --short HEAD)
  info "HEAD is at ${DIM}${GIT_HASH}${RESET}"
else
  banner 4 "Committing version bump"

  if [[ "$VERSION_CHANGED" == true ]] && { [[ "$DRY_RUN" == true ]] || ! git diff --quiet package.json; }; then
    run "Git add" git add package.json
    run "Git commit" git commit -m "chore: bump version to ${VERSION}"
    run "Git push" git push
    GIT_HASH=$(git rev-parse --short HEAD)
    success "Committed and pushed version bump — ${DIM}${GIT_HASH}${RESET}"
  elif [[ "$VERSION_CHANGED" == true ]]; then
    GIT_HASH=$(git rev-parse --short HEAD)
    warn "package.json was updated but git diff is clean (already staged?) — skipping commit"
  else
    GIT_HASH=$(git rev-parse --short HEAD)
    warn "No version change — skipping commit"
  fi
fi

# ── --prepare-only: exit here before touching GitHub ─────────────────────────
if [[ "$PREPARE_ONLY" == true ]]; then
  echo ""
  if [[ "$DRY_RUN" == true ]]; then
    echo -e "${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${BOLD}${YELLOW}  ⚠   Dry run + prepare-only complete — no changes were made${RESET}"
    echo -e "${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "  ${DIM}Next    :${RESET}  Run without ${BOLD}--dry-run${RESET} to actually build and prepare:"
    echo -e "           ${CYAN}./scripts/release.sh --prepare-only ${VERSION}${RESET}"
  else
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${BOLD}${CYAN}  ✔   Prepare phase complete — artifacts are in dist/${RESET}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "  ${DIM}Commit  :${RESET}  ${GIT_HASH}"
    ASSET_COUNT=0
    for pattern in dist/*.AppImage dist/*.deb dist/*.dmg dist/*.zip dist/*.exe; do
      for f in $pattern; do [[ -f "$f" ]] && ASSET_COUNT=$(( ASSET_COUNT + 1 )); done
    done
    echo -e "  ${DIM}Assets  :${RESET}  ${ASSET_COUNT} file(s) in dist/"
    echo -e "  ${DIM}Next    :${RESET}  Review artifacts, then run:"
    echo -e "           ${CYAN}./scripts/release.sh --upload-only${RESET}"
  fi
  echo ""
  exit 0
fi

# ── Gather release note metadata ─────────────────────────────────────────────
NODE_VERSION=$(node --version)
ELECTRON_VERSION=$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || echo "unknown")
BUILD_DATE=$(date -u "+%Y-%m-%d %H:%M UTC")

# Find the previous tag for the changelog. Normally `git describe HEAD^` works,
# but during a re-release we must skip the very tag we're about to replace —
# otherwise the changelog ends up scoped against the bad release.
if [[ "$RERELEASE" == true ]]; then
  PREV_TAG=$(git tag --list --sort=-v:refname \
    | grep -v "^${VERSION}\$" \
    | head -1 || true)
else
  PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
fi
if [[ -n "$PREV_TAG" ]]; then
  CHANGELOG=$(git log "${PREV_TAG}..HEAD" --pretty=format:"- %s (%h)" --no-merges 2>/dev/null || echo "- No commits found")
  SINCE_LABEL="since \`${PREV_TAG}\`"
else
  CHANGELOG=$(git log HEAD --pretty=format:"- %s (%h)" --no-merges 2>/dev/null || echo "- No commits found")
  SINCE_LABEL="(initial release)"
fi

# Collect only files that exist (guards against missing platform artifacts)
ASSETS=()
for pattern in dist/*.AppImage dist/*.deb dist/*.dmg dist/*.zip dist/*.exe; do
  for f in $pattern; do
    [[ -f "$f" ]] && ASSETS+=("$f")
  done
done

NODE_VERSION=$(node --version)
NOTES_FILE=$(mktemp "${TMPDIR:-/tmp}/release-notes.XXXXXX")
trap 'rm -f "${NOTES_FILE}"' EXIT

cat > "${NOTES_FILE}" <<ENDOFNOTES
## ${APP_NAME} ${VERSION}

**Released:** ${BUILD_DATE}
**Commit:** ${GIT_HASH}

---


### Build Environment

> **App version:** ${VERSION_BARE}
> **Node.js:** ${NODE_VERSION}
> **Electron:** ${ELECTRON_VERSION}
> **Platform:** $(uname -s) $(uname -m)
> **Built:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")

---

### Changes ${SINCE_LABEL}

${CHANGELOG}
ENDOFNOTES

# ── Step 5: Publish GitHub release ──────────────────────────────────────────
banner 5 "Publishing GitHub release"
TOTAL_ASSETS=${#ASSETS[@]}

if [[ "$DRY_RUN" == true ]]; then
  dryrun "gh release create ${VERSION} --title \"${VERSION}\" --notes-file <notes>"
  echo ""
  idx=0
  for f in "${ASSETS[@]}"; do
    idx=$(( idx + 1 ))
    fname=$(basename "$f")
    size=$(du -sh "$f" 2>/dev/null | cut -f1)
    echo -e "  ${YELLOW}${DIM}◌  [dry run]${RESET}  ${CYAN}[${idx}/${TOTAL_ASSETS}]${RESET}  ${BOLD}${fname}${RESET}  ${DIM}(${size})${RESET}"
  done
  echo ""
  info "Release notes preview:"
  echo ""
  cat "${NOTES_FILE}" | sed 's/^/    /'
  echo ""
  RELEASE_URL="(not created — dry run)"
else
  if [[ "$RERELEASE" == true ]]; then
    warn "Deleting existing release and tag ${VERSION} (--re-release)..."
    gh release delete "${VERSION}" --yes 2>/dev/null || true
    git tag -d "${VERSION}" 2>/dev/null || true
    # Delete the remote tag and wait until it is confirmed gone before proceeding —
    # gh release create will return HTTP 422 if the tag still exists on the remote.
    if git ls-remote --tags origin "refs/tags/${VERSION}" 2>/dev/null | grep -q .; then
      git push origin ":refs/tags/${VERSION}"
      # Poll until the remote tag is gone (up to ~10s)
      for i in 1 2 3 4 5; do
        sleep 2
        git ls-remote --tags origin "refs/tags/${VERSION}" 2>/dev/null | grep -q . || break
        warn "Waiting for remote tag ${VERSION} to be removed… (${i}/5)"
      done
      if git ls-remote --tags origin "refs/tags/${VERSION}" 2>/dev/null | grep -q .; then
        fail "Remote tag ${VERSION} could not be removed. Try:\n     git push origin :refs/tags/${VERSION}"
      fi
    fi
    success "Existing release and tag removed"
    echo ""
  fi
  info "Creating release (no assets yet)..."
  # Pin the new tag to the commit we just built from, not the remote default-branch HEAD.
  RELEASE_TARGET=$(git rev-parse HEAD)
  gh release create "${VERSION}" \
    --target "${RELEASE_TARGET}" \
    --title "${VERSION}" \
    --notes-file "${NOTES_FILE}"
  # Explicitly create (or move) the local tag ref to match the commit GitHub tagged.
  git tag -f "${VERSION}" "${RELEASE_TARGET}"
  RELEASE_URL=$(gh release view "${VERSION}" --json url -q .url 2>/dev/null || echo "https://github.com")

  echo ""
  info "Uploading ${TOTAL_ASSETS} artifact(s)..."
  echo ""
  idx=0
  for f in "${ASSETS[@]}"; do
    idx=$(( idx + 1 ))
    fname=$(basename "$f")
    size=$(du -sh "$f" 2>/dev/null | cut -f1)
    echo -ne "  ${CYAN}[${idx}/${TOTAL_ASSETS}]${RESET}  ${BOLD}${fname}${RESET}  ${DIM}(${size})${RESET}  … "
    gh release upload "${VERSION}" "${f}" > /dev/null 2>&1
    echo -e "${GREEN}✔  uploaded${RESET}"
  done
  echo ""
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [[ "$DRY_RUN" == true ]]; then
  echo -e "${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}${YELLOW}  ⚠   Dry run complete — no changes were made${RESET}"
  echo -e "${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
else
  echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}${GREEN}  ✅  Release ${VERSION} published successfully!${RESET}"
  echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
fi
echo -e "  ${DIM}URL     :${RESET}  ${RELEASE_URL}"
echo -e "  ${DIM}Commit  :${RESET}  ${GIT_HASH}"
echo -e "  ${DIM}Assets  :${RESET}  ${#ASSETS[@]} files uploaded"
echo -e "  ${DIM}Total   :${RESET}  $(elapsed)"
echo ""

