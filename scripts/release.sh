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
WHITE='\033[0;97m'
YELLOW='\033[0;33m'
RESET='\033[0m'

print_help() {
  echo -e "
${BOLD}${WHITE}Usage:${RESET}
  ${CYAN}./scripts/release.sh${RESET} [options] <version>

${BOLD}${WHITE}Arguments:${RESET}
  ${BOLD}<version>${RESET}       Release version. Must be >= current package.json version.
                  The leading ${BOLD}v${RESET} is optional — both ${BOLD}v1.2.3${RESET} and ${BOLD}1.2.3${RESET} are accepted.

${BOLD}${WHITE}Options:${RESET}
  ${BOLD}--dry-run${RESET}       Simulate the release without making any changes.
                  Validates version, shows each artifact that would be uploaded
                  (with file size), and prints a full preview of the release notes.
                  No files are written, no commits made, nothing pushed or published.
  ${BOLD}--re-release${RESET}     Re-publish an already-released version with rebuilt artifacts and
                  refreshed release notes. Re-uses the requested version number (no
                  package.json bump needed), generates the changelog against the
                  previous good tag (skipping the version being re-released),
                  deletes the existing GitHub release and git tag, and re-creates
                  them pinned to the current HEAD commit. Use this to recover from
                  a broken release of the same version.
  ${BOLD}--seq${RESET}           Build platforms sequentially instead of in parallel.
                  Slower overall, but produces clean non-interleaved build output —
                  useful for debugging build failures.
  ${BOLD}--install-prereqs${RESET}  Auto-install any missing build/release prerequisites before
                  proceeding (uses Homebrew on macOS, apt/dnf/pacman on Linux,
                  winget/choco on Windows). Combine with ${BOLD}--dry-run${RESET} to preview
                  the install plan only. Things that are too risky to auto-install
                  (Node major upgrades, ${DIM}gh auth login${RESET}, .deb tooling on Windows →
                  WSL) are surfaced as manual steps. Alias: ${BOLD}--install-deps${RESET}.
                  Signing tools (codesign, signtool) and signing-related env vars
                  (CSC_LINK, WIN_CSC_LINK, APPLE_*) are NOT auto-installed.
  ${BOLD}--help${RESET}          Show this help message and exit.

${BOLD}${WHITE}What the script does:${RESET}
  0. Verifies prerequisites are installed:
     • ${BOLD}node${RESET} ≥ 18, ${BOLD}npm${RESET}, ${BOLD}node_modules${RESET} (electron-builder)
     • ${BOLD}git${RESET}, ${BOLD}gh${RESET} CLI (and that gh is authenticated)
     • ${BOLD}dpkg${RESET}, ${BOLD}fakeroot${RESET}, GNU ${BOLD}ar${RESET} (for building .deb on macOS)
     With ${BOLD}--install-prereqs${RESET}, missing tools are installed automatically
     (or, where unsafe to auto-install, surfaced as manual steps).
     Also verifies the working tree is clean (no uncommitted changes apart
     from package.json, no unpushed commits) so the published tag is reproducible.
  1. Validates the requested version against the current package.json version.
  2. Bumps the version in package.json (if it changed).
  3. Builds all platform packages in parallel via ${BOLD}npm run package:all:clean${RESET}
     (or sequentially via ${BOLD}npm run package:seq:clean${RESET} when ${BOLD}--seq${RESET} is set).
  4. Commits and pushes the package.json version bump (if a change was made).
  5. Creates and publishes a GitHub release with all dist/ artifacts and rich release notes.

${BOLD}${WHITE}Prerequisites:${RESET}
  • Run from the repository root directory.
  • ${BOLD}node${RESET} and ${BOLD}npm${RESET} must be installed and ${BOLD}node_modules${RESET} present (${DIM}npm install${RESET}).
  • ${BOLD}gh${RESET} (GitHub CLI) must be installed and authenticated (${DIM}gh auth login${RESET}).
  • ${BOLD}git${RESET} must be configured with commit access to the repository.

${BOLD}${WHITE}Examples:${RESET}
  ${DIM}# Standard release${RESET}
  ${CYAN}./scripts/release.sh v1.2.3${RESET}

  ${DIM}# Version without 'v' prefix (equivalent)${RESET}
  ${CYAN}./scripts/release.sh 1.2.3${RESET}

  ${DIM}# Preview everything without making any changes${RESET}
  ${CYAN}./scripts/release.sh --dry-run v1.2.3${RESET}

  ${DIM}# Flag order doesn't matter${RESET}
  ${CYAN}./scripts/release.sh v1.2.3 --dry-run${RESET}

  ${DIM}# Re-release the same version (deletes existing release + tag first, rebuilds, refreshes notes)${RESET}
  ${CYAN}./scripts/release.sh --re-release v1.2.3${RESET}

  ${DIM}# Build platforms sequentially (clean, non-interleaved output)${RESET}
  ${CYAN}./scripts/release.sh --seq v1.2.3${RESET}

  ${DIM}# Auto-install any missing prerequisites first (brew / apt / winget)${RESET}
  ${CYAN}./scripts/release.sh --install-prereqs v1.2.3${RESET}

  ${DIM}# Preview just the prereq install plan (no install, no release)${RESET}
  ${CYAN}./scripts/release.sh --install-prereqs --dry-run v1.2.3${RESET}
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
VERSION=""

for arg in "$@"; do
  case "$arg" in
    --dry-run)              DRY_RUN=true ;;
    --re-release)            RERELEASE=true ;;
    --seq)                  SEQ=true ;;
    --install-prereqs|--install-deps)  INSTALL_PREREQS=true ;;
    *)                      VERSION="$arg" ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  fail "Version argument is required.\n     Usage: $0 [--dry-run] <version>  (e.g. $0 v1.0.0)"
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
if [[ "$INSTALL_PREREQS" == true ]]; then
  echo -e "${BOLD}${GREEN}  ⓘ   INSTALL-PREREQS — missing build/release tools will be auto-installed${RESET}"
fi
echo -e "${BOLD}${WHITE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# ── Step 0: Build prerequisites ──────────────────────────────────────────────
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

# ── Step 0.5: Working tree must be clean ─────────────────────────────────────
# Block the release if there are uncommitted changes (other than package.json,
# which the script itself may modify) or unpushed commits — a release should
# always reflect what's on the remote and be reproducible from the published tag.
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

# ── Step 1: Version gate ─────────────────────────────────────────────────────
banner 1 "Validating version"

CURRENT_VERSION=$(node -p "require('./package.json').version")
info "Current package.json version : ${BOLD}${CURRENT_VERSION}${RESET}"
info "Requested release version    : ${BOLD}${VERSION_BARE}${RESET}"

if semver_lt "${VERSION_BARE}" "${CURRENT_VERSION}"; then
  fail "Requested version ${BOLD}${VERSION}${RESET} is lower than the current package.json version ${BOLD}v${CURRENT_VERSION}${RESET}.\n     Please provide a version >= v${CURRENT_VERSION}."
fi

success "Version is valid"

# ── Step 2: Bump package.json ────────────────────────────────────────────────
banner 2 "Updating package.json version"

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

# ── Step 3: Build ────────────────────────────────────────────────────────────
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

# ── Step 4: Commit version bump ──────────────────────────────────────────────
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

