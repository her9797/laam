import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Regression guard for the whole-branch review finding that i18n covered
 * only the app shell while every feature page was hardcoded Korean.
 *
 * Rule: no source file under `features/` may contain a Hangul character
 * outside a comment. Copy belongs in `i18n/resources.ts` and reaches the UI
 * through `t()`; a new page added with zero i18n coverage fails here rather
 * than shipping Korean-only.
 *
 * Deliberately NOT covered, and why:
 *   - `app/**` route `metadata` (page `<title>`s) and `app/api/**` JSON error
 *     bodies are rendered on the server, which cannot know the operator's
 *     language: this app resolves the locale in the browser, from
 *     `localStorage`. Those stay Korean until a locale-in-URL scheme exists.
 *   - Test files, which assert against the Korean (default) rendering.
 */

const featuresDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "features");

/**
 * Files allowed to contain Hangul, with the reason. Each entry must be a
 * non-UI string — protocol/wire data, never something an operator reads.
 */
const ALLOWED: Record<string, string> = {
  "dashboard/summary.ts":
    "the '[노래 신청]' prefix is a wire convention shared with laam-web's customer screens, not display copy",
};

const HANGUL = /[가-힣]/;

/**
 * Strips block and line comments so prose in a doc comment (this codebase
 * documents Korean API/field names in comments freely) isn't mistaken for
 * user-facing copy. Over-stripping here can only hide a violation, never
 * invent one, so a naive strip is safe for a guard test.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// Plain `node:fs` rather than a glob library: this repo declares no glob
// dependency of its own, and only transitive ones are installed.
const sourceFiles = readdirSync(featuresDir, { recursive: true, encoding: "utf8" })
  .map((entry) => entry.split("\\").join("/"))
  .filter((entry) => /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
  .sort();

describe("feature sources carry no hardcoded Korean copy", () => {
  it("finds the feature sources to scan", () => {
    // Guards the guard: a broken glob would silently pass everything.
    expect(sourceFiles.length).toBeGreaterThan(15);
  });

  it.each(sourceFiles)("%s has no Hangul outside comments", (file) => {
    const contents = stripComments(readFileSync(resolve(featuresDir, file), "utf8"));
    const offendingLines = contents
      .split("\n")
      .map((line, index) => ({ line: index + 1, text: line.trim() }))
      .filter((entry) => HANGUL.test(entry.text));

    if (ALLOWED[file]) {
      expect(offendingLines.length, `${file} no longer needs its allowlist entry`).toBeGreaterThan(0);
      return;
    }

    expect(
      offendingLines,
      `${file} has hardcoded Korean text. Move it into i18n/resources.ts and render it with t().`,
    ).toEqual([]);
  });

  it("keeps the allowlist honest (every entry names a file that still exists)", () => {
    for (const allowed of Object.keys(ALLOWED)) {
      expect(sourceFiles).toContain(allowed);
    }
  });
});
