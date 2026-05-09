/**
 * Copyright 2026 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Edit-distance helpers for CLI "Did you mean ...?" suggestions.
 *
 * Levenshtein distance counts the minimum insertions, deletions, and substitutions
 * needed to turn one string into another. That makes it a better fit for command
 * typo recovery than character-overlap scoring because order and extra/missing
 * characters affect the score predictably.
 */
function levenshteinDistance(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');

  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

function normalizeCliToken(value) {
  return String(value ?? '')
    .trim()
    .replace(/^-+/, '')
    .toLowerCase();
}

function suggestionMaxDistance(input, candidate) {
  const length = Math.max(normalizeCliToken(input).length, normalizeCliToken(candidate).length);
  if (length <= 4) return 1;
  if (length <= 8) return 2;
  if (length <= 14) return 3;
  return 4;
}

function getClosestSuggestion(input, candidates) {
  const normalizedInput = normalizeCliToken(input);
  if (!normalizedInput) return null;

  let best = null;
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeCliToken(candidate);
    if (!normalizedCandidate) continue;

    const distance = levenshteinDistance(normalizedInput, normalizedCandidate);
    const maxDistance = suggestionMaxDistance(normalizedInput, normalizedCandidate);
    if (distance > maxDistance) continue;

    if (!best
      || distance < best.distance
      || (distance === best.distance && normalizedCandidate.length < normalizeCliToken(best.value).length)
      || (distance === best.distance && normalizedCandidate.length === normalizeCliToken(best.value).length && String(candidate).localeCompare(String(best.value)) < 0)) {
      best = { value: candidate, distance };
    }
  }

  return best ? best.value : null;
}

function formatDidYouMean(input, candidates, { quote = "'" } = {}) {
  const suggestion = getClosestSuggestion(input, candidates);
  return suggestion ? ` Did you mean ${quote}${suggestion}${quote}?` : '';
}

module.exports = {
  formatDidYouMean,
  getClosestSuggestion,
  levenshteinDistance,
  normalizeCliToken,
};

