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
  ${BOLD}-s${RESET}  ${DIM}--dry-run  --simulate${RESET}
        Simulate the release without making any changes. Validates the version,
        lists each artifact that would be uploaded (with file size), and prints a
        full preview of the release notes. Nothing is written, committed, or published.

  ${BOLD}-p${RESET}  ${DIM}--prepare-only${RESET}
        Run Steps 0–4 only (prereqs, version bump, build, commit + push) then exit
        before creating or uploading the GitHub release. Inspect ${CYAN}dist/${RESET} artifacts,
        sign them if needed, then publish with ${BOLD}--upload-only${RESET}.
        Stacks with ${BOLD}--seq${RESET}, ${BOLD}--install-prereqs${RESET}, and ${BOLD}--dry-run${RESET}.

  ${BOLD}-u${RESET}  ${DIM}--upload-only${RESET}
        Skip Steps 0–4 and jump straight to Step 5 (create GitHub release + upload
        ${CYAN}dist/${RESET} artifacts). Version is read from package.json — no argument needed.
        Use after ${BOLD}--prepare-only${RESET}, or when artifacts were built externally (e.g. CI).
        Only ${BOLD}gh${RESET} CLI is required — build tools are not checked.
        Stacks with ${BOLD}--re-release${RESET} and ${BOLD}--dry-run${RESET}.

  ${BOLD}-R${RESET}  ${DIM}--re-release${RESET}
        Re-publish an already-released version with rebuilt artifacts and refreshed
        release notes. Deletes the existing GitHub release and git tag, then
        re-creates them pinned to HEAD. Generates the changelog against the previous
        good tag (skipping the version being re-released). Use this to recover from
        a broken release of the same version.

  ${BOLD}-S${RESET}  ${DIM}--seq${RESET}
        Build platforms sequentially instead of in parallel. Slower overall, but
        produces clean non-interleaved output — useful for debugging build failures.

  ${BOLD}-i${RESET}  ${DIM}--install-prereqs  --install-deps${RESET}
        Auto-install any missing build/release prerequisites (Homebrew on macOS,
        apt/dnf/pacman on Linux, winget/choco on Windows). Combine with ${BOLD}--dry-run${RESET}
        to preview the install plan only. Node major upgrades, ${BOLD}gh auth login${RESET}, and
        .deb tooling on Windows (→ WSL) are surfaced as manual steps.
        ${YELLOW}⚠${RESET}  Signing tools and env vars (CSC_LINK, WIN_CSC_LINK, APPLE_*) are NOT
           auto-installed.

  ${BOLD}-h${RESET}  ${DIM}--help${RESET}
        Show this help message and exit.

  ${BOLD}-l${RESET}  ${DIM}--list${RESET}
        List all published GitHub releases for this repository and exit.
        Requires ${BOLD}gh${RESET} CLI to be installed and authenticated.
        Outputs a table with columns: ${BOLD}TAG · DATE · STATUS · URL${RESET}.
        STATUS is colour-coded: ${GREEN}● latest${RESET}  ${YELLOW}◐ pre${RESET}  ${DIM}○ draft${RESET}.
        Pair with ${BOLD}--limit${RESET} ${DIM}<n>${RESET} to control how many releases are shown ${DIM}(default: 10)${RESET}.

  ${BOLD}--limit${RESET}  ${DIM}<n>${RESET}
        Maximum number of releases to show with ${BOLD}--list${RESET}. Default: ${DIM}10${RESET}.

${BOLD}${WHITE}PIPELINE${RESET}
  Step 0  Check prerequisites + verify clean working tree
  Step 1  Validate requested version (blocks downgrades)
  Step 2  Bump version in package.json
  Step 3  Build all platform packages  ${DIM}(parallel by default; --seq for serial)${RESET}
  Step 4  Commit + push the version bump
  Step 5  Create GitHub release + upload dist/ artifacts

  ${DIM}--prepare-only  stops after Step 4  (build + commit, no GitHub upload)${RESET}
  ${DIM}--upload-only   starts at  Step 5  (upload only, skips build entirely)${RESET}

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
  ${CYAN}./scripts/release.sh -s v1.2.3${RESET}

  ${DIM}# Two-phase: build + commit now, review artifacts, upload later${RESET}
  ${CYAN}./scripts/release.sh --prepare-only v1.2.3${RESET}
  ${CYAN}./scripts/release.sh --upload-only${RESET}

  ${DIM}# Two-phase with sequential build (clean output, useful for debugging)${RESET}
  ${CYAN}./scripts/release.sh -p -S v1.2.3${RESET}
  ${CYAN}./scripts/release.sh -u${RESET}

  ${DIM}# Upload-only for externally produced artifacts (e.g. from CI)${RESET}
  ${CYAN}./scripts/release.sh -u${RESET}

  ${DIM}# Recover from a broken release — delete + rebuild + re-upload${RESET}
  ${CYAN}./scripts/release.sh --re-release v1.2.3${RESET}

  ${DIM}# Re-upload only (skip rebuild — reuse existing dist/ artifacts)${RESET}
  ${CYAN}./scripts/release.sh -u -R${RESET}

  ${DIM}# Sequential build (clean output, slower)${RESET}
  ${CYAN}./scripts/release.sh --seq v1.2.3${RESET}

  ${DIM}# Auto-install missing prerequisites, then release${RESET}
  ${CYAN}./scripts/release.sh --install-prereqs v1.2.3${RESET}

  ${DIM}# Preview prereq install plan only (no install, no release)${RESET}
  ${CYAN}./scripts/release.sh -i -s v1.2.3${RESET}

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

banner() {
  local step="$1" msg="$2"
  local tag=""
  [[ "$DRY_RUN"          == true ]] && tag="${tag} ${BOLD}${YELLOW}[dry run]${RESET}${BOLD}${CYAN}"
  [[ "$RERELEASE"        == true ]] && tag="${tag} ${BOLD}${RED}[re-release]${RESET}${BOLD}${CYAN}"
  [[ "$SEQ"              == true ]] && tag="${tag} ${BOLD}${CYAN}[seq]${RESET}${BOLD}${CYAN}"
  [[ "$PREPARE_ONLY"     == true ]] && tag="${tag} ${BOLD}${CYAN}[prepare-only]${RESET}${BOLD}${CYAN}"
  [[ "$UPLOAD_ONLY"      == true ]] && tag="${tag} ${BOLD}${GREEN}[upload-only]${RESET}${BOLD}${CYAN}"
  [[ "$INSTALL_PREREQS"  == true ]] && tag="${tag} ${BOLD}${GREEN}[install-prereqs]${RESET}${BOLD}${CYAN}"
  echo ""
  echo -e "${BOLD}${CYAN}┌─ Step ${step}${tag} ─────────────────────────────────────────────────────${RESET}"
  echo -e "${BOLD}${CYAN}│${RESET}  ${WHITE}${msg}${RESET}"
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
LIST=false
LIST_LIMIT=10
VERSION=""
PREV_ARG=""

for arg in "$@"; do
  case "$arg" in
    --dry-run|--simulate|-s)             DRY_RUN=true ;;
    --re-release|-R)                     RERELEASE=true ;;
    --seq|-S)                            SEQ=true ;;
    --prepare-only|-p)                   PREPARE_ONLY=true ;;
    --upload-only|-u)                    UPLOAD_ONLY=true ;;
    --install-prereqs|--install-deps|-i) INSTALL_PREREQS=true ;;
    --list|-l)                           LIST=true ;;
    --limit=*)                           LIST_LIMIT="${arg#--limit=}" ;;
    --limit)                             ;;   # value consumed in next iteration
    *)
      if [[ "$PREV_ARG" == "--limit" ]]; then
        LIST_LIMIT="$arg"
      else
        VERSION="$arg"
      fi
      ;;
  esac
  PREV_ARG="$arg"
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
    fail "Working tree must be clean before releasing.\n     Commit & push your changes, then re-run."
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
    run "Write package.json" node -e "
      const fs = require('fs');
      const pkg = require('./package.json');
      pkg.version = '${VERSION_BARE}';
      fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
    "
    success "package.json version updated: ${DIM}${CURRENT_VERSION}${RESET} → ${BOLD}${VERSION_BARE}${RESET}"
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
  echo ""

  BUILD_START=$(date +%s)
  run "Build" npm run "${BUILD_SCRIPT}"
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

  # ── Re-release: rebase bump commit to HEAD so the tag lands on it ──────────
  # When re-releasing, any fix commits pushed after the original release sit
  # between the bump commit and HEAD. Rebase the bump commit onto HEAD so it
  # becomes the last commit — the canonical anchor for the new tag.
  if [[ "$RERELEASE" == true ]]; then
    BUMP_MSG="chore: bump version to ${VERSION}"
    BUMP_SHA=$(git log --grep="${BUMP_MSG}" --format="%H" --all | head -1 || true)

    if [[ -z "$BUMP_SHA" ]]; then
      # No bump commit found — create one now (e.g. very first release being re-released)
      warn "No prior bump commit found — creating one now"
      if [[ "$DRY_RUN" == true ]]; then
        dryrun "git add package.json && git commit -m \"${BUMP_MSG}\""
        dryrun "git push"
      else
        git add package.json
        git commit --allow-empty -m "${BUMP_MSG}"
        git push
      fi
      GIT_HASH=$(git rev-parse --short HEAD)
      success "Created bump commit — ${DIM}${GIT_HASH}${RESET}"
    elif [[ "$(git rev-parse "${BUMP_SHA}")" == "$(git rev-parse HEAD)" ]]; then
      # Bump commit is already HEAD — nothing to rebase
      GIT_HASH=$(git rev-parse --short HEAD)
      info "Bump commit is already HEAD — no rebase needed (${DIM}${GIT_HASH}${RESET})"
    else
      # Bump commit exists but is not HEAD — rebase it onto HEAD
      BUMP_SHA_SHORT=$(git rev-parse --short "${BUMP_SHA}")
      BUMP_PARENT=$(git rev-parse "${BUMP_SHA}^")
      info "Rebasing bump commit ${DIM}${BUMP_SHA_SHORT}${RESET} onto HEAD…"
      if [[ "$DRY_RUN" == true ]]; then
        dryrun "git rebase --onto HEAD ${BUMP_PARENT} ${BUMP_SHA}"
        dryrun "git push --force-with-lease"
      else
        # Detach HEAD, cherry-pick the bump commit on top of it, then update the branch
        CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
        OLD_HEAD=$(git rev-parse HEAD)
        git rebase --onto HEAD "${BUMP_PARENT}" "${BUMP_SHA}"
        # After rebase, HEAD is detached at the newly placed commit — update branch ref
        REBASED_SHA=$(git rev-parse HEAD)
        git checkout -q "${CURRENT_BRANCH}"
        git reset --hard "${REBASED_SHA}"
        git push --force-with-lease
        GIT_HASH=$(git rev-parse --short HEAD)
        success "Rebased bump commit onto HEAD — ${DIM}${BUMP_SHA_SHORT}${RESET} → ${BOLD}${GIT_HASH}${RESET}"
      fi
    fi
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
    # Only try to delete the remote tag if it exists
    if git ls-remote --tags origin "refs/tags/${VERSION}" 2>/dev/null | grep -q .; then
      git push origin ":refs/tags/${VERSION}" 2>/dev/null || true
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

