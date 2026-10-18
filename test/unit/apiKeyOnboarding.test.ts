import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the "how to get an API key" story across every file a new user sees.
 *
 * WHY: the docs used to tell users to "sign up at prod.grouter.web.id → dashboard
 * → Create Key". There is no signup, no dashboard, and no self-service key
 * creation — keys are bought from the Telegram bot and paid via QRIS. The old
 * text sent every new user down a dead end, and the wrong key prefix
 * (`gRouter-...` / `gRoute...`) was repeated in code as well as docs.
 *
 * A key is `grx_...`. The only legitimate entry point is the Telegram bot.
 *
 * NOTE: CHANGELOG.md and docs/AUDIT-FITUR.md legitimately *quote* the old wrong
 * wording when explaining what was broken. A quoted phrase only counts as an
 * offence when it is NOT sitting in a line that marks it as wrong/superseded.
 */

const ROOT = join(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * Files a new user is expected to read, or that speak to them at runtime.
 * These must contain the corrected story and nothing else.
 */
const USER_FACING = [
  "README.md",
  "docs/USER-GUIDE.md",
  "docs/PRD.md",
  "docs/ARCHITECTURE.md",
  "src/commands/index.ts",
  "src/chat/participant.ts",
  "src/llm/errors.ts",
];

/** Documents that may quote old wording, provided the line flags it as wrong. */
const HISTORICAL = ["CHANGELOG.md", "docs/AUDIT-FITUR.md"];

/** A line is "marked as wrong" when it says so explicitly. */
const MARKED_WRONG =
  /wrong|incorrect|incorrectly|mistake|mistaken|broken|bug|previously|used to|formerly|no longer|not exist|does not exist|salah|sebelum|dulu|keliru|bukan|gak ada|tidak ada|fixed|correction|corrected|audit/i;

const FORBIDDEN = [
  /Open API Keys Dashboard/,
  /Link to dashboard/,
  /Create Key/,
  /Buat Key/,
  /Daftar\s*\/\s*masuk/,
];

const WRONG_PREFIX = [/`gRouter-\.\.\.`/i, /`gRouter-…`/i, /gRoute\.\.\./];

function findOffenders(rel: string, patterns: RegExp[], allowQuoted: boolean): string[] {
  const offenders: string[] = [];
  const lines = read(rel).split("\n");
  lines.forEach((line, idx) => {
    for (const re of patterns) {
      const m = line.match(re);
      if (!m) continue;
      // In historical docs a quoted phrase is fine when the line says it was wrong.
      if (allowQuoted && MARKED_WRONG.test(line)) continue;
      offenders.push(`${rel}:${idx + 1}: "${m[0]}"`);
    }
  });
  return offenders;
}

describe("API key onboarding contract", () => {
  it("never advertises a self-service dashboard or signup for keys", () => {
    const offenders = [
      ...USER_FACING.flatMap((rel) => findOffenders(rel, FORBIDDEN, false)),
      ...HISTORICAL.flatMap((rel) => findOffenders(rel, FORBIDDEN, true)),
    ];
    expect(
      offenders,
      `forbidden dashboard/signup wording:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("never uses the wrong key prefix", () => {
    const offenders = [
      ...USER_FACING.flatMap((rel) => findOffenders(rel, WRONG_PREFIX, false)),
      ...HISTORICAL.flatMap((rel) => findOffenders(rel, WRONG_PREFIX, true)),
    ];
    expect(offenders, `wrong key prefix:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the historical exemption still requires an explicit correction marker", () => {
    // Guard the guard: if the marker regex silently stopped matching, the
    // exemptions above would silently widen. Assert it still recognises the
    // phrasing our own changelog uses.
    expect(MARKED_WRONG.test("- The API key prefix was wrong (`gRouter-...`).")).toBe(true);
    expect(MARKED_WRONG.test("Sign up at prod.grouter.web.id and click Create Key.")).toBe(false);
  });

  it("points users at the Telegram bot to buy a key", () => {
    // The user guide is where the buy flow must be spelled out in full.
    const guide = read("docs/USER-GUIDE.md");
    expect(guide).toContain("https://t.me/grouteerbot");
    expect(guide).toMatch(/QRIS/i);
    expect(guide).toMatch(/dibeli|beli/i);
    expect(guide).toContain("grx_");

    // README's key row must send users to the bot, not to the marketing site.
    const readme = read("README.md");
    const row = readme.split("\n").find((l) => l.includes("| **Get an API key** |"));
    expect(row, "README must have a 'Get an API key' row").toBeTruthy();
    expect(row).toContain("t.me/grouteerbot");
  });

  it("runtime errors tell the user where to get a key", () => {
    // A 401 with no next step is the worst possible error for a new user.
    const errs = read("src/llm/errors.ts");
    expect(errs).toContain("t.me/grouteerbot");

    const cmds = read("src/commands/index.ts");
    expect(cmds).toContain("t.me/grouteerbot");
    expect(cmds).toContain("grx_");

    const participant = read("src/chat/participant.ts");
    expect(participant).toContain("t.me/grouteerbot");
  });
});
