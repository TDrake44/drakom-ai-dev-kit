import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The skills `npx skills add TDrake44/drakom-ai-dev-kit` should offer. */
const OFFERED_SKILLS = ['drakom-ai-setup', 'drakom-dev', 'drakom-handoff', 'drakom-plan', 'drakom-plan-audit', 'drakom-pr', 'drakom-review'];

/** The kit skills the 0.6.0 CLI installs from `payload.json`. The others install with `npx skills add` only. */
const PAYLOAD_SKILLS = ['drakom-ai-setup', 'drakom-plan-audit'];

/** Files Git tracks, which is what an install from GitHub sees. */
function trackedFiles() {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\0').filter(Boolean);
}

/**
 * The frontmatter of a SKILL.md, parsed as YAML the way the `skills` CLI does.
 * @param {string} relativePath
 * @returns {Promise<Record<string, unknown>>}
 */
async function readFrontmatter(relativePath) {
  const content = (await readFile(path.join(repositoryRoot, relativePath), 'utf8')).replaceAll('\r\n', '\n');
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  assert.ok(match, `${relativePath} has no frontmatter`);
  const data = yaml.load(match[1]);
  assert.ok(data !== null && typeof data === 'object', `${relativePath} frontmatter is not a mapping`);
  return /** @type {Record<string, unknown>} */ (data);
}

/** @param {Record<string, unknown>} frontmatter */
function isInternal(frontmatter) {
  const metadata = frontmatter.metadata;
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const internal = /** @type {Record<string, unknown>} */ (metadata).internal;
  return internal === true || internal === 'true' || internal === '1';
}

/**
 * What the `skills` CLI (1.9.0) offers from this repository. It searches `skills/` before every
 * agent folder (`.agents/skills`, `.claude/skills` and others), keeps the first skill of each name,
 * and drops a `metadata.internal` skill before recording its name, so a hidden skill does not
 * shadow a later copy of the same name. This checks every tracked SKILL.md, a superset of the
 * folders the CLI reads.
 */
async function offeredSkills() {
  const skillFiles = trackedFiles()
    .filter((file) => path.posix.basename(file) === 'SKILL.md')
    .sort((left, right) => {
      const rank = (/** @type {string} */ file) => (file.startsWith('skills/') ? 0 : 1);
      return rank(left) - rank(right) || left.localeCompare(right);
    });
  const offered = new Map();
  for (const file of skillFiles) {
    const frontmatter = await readFrontmatter(file);
    if (isInternal(frontmatter)) continue;
    const name = String(frontmatter.name);
    if (!offered.has(name)) offered.set(name, file);
  }
  return offered;
}

test('npx skills add offers exactly the drakom-* kit skills, each from skills/', async () => {
  const offered = await offeredSkills();

  assert.deepEqual([...offered.keys()].sort(), OFFERED_SKILLS);
  for (const name of OFFERED_SKILLS) {
    assert.equal(offered.get(name), `skills/${name}/SKILL.md`);
  }
});

test('every kit skill under skills/ is named after its folder', async () => {
  const skillFiles = trackedFiles().filter((file) => /^skills\/[^/]+\/SKILL\.md$/.test(file));

  assert.deepEqual(skillFiles.map((file) => file.split('/')[1]).sort(), OFFERED_SKILLS);
  for (const file of skillFiles) {
    const frontmatter = await readFrontmatter(file);
    assert.equal(frontmatter.name, file.split('/')[1]);
    assert.equal(typeof frontmatter.description, 'string');
  }
});

/** Setup references that install with `npx skills add` only; the CLI's payload predates them. */
const NPX_ONLY_FILES = ['pull_request_template.md', 'rules-README.md', 'rules-audit.md', 'specs-README.md'].map(
  (file) => `skills/drakom-ai-setup/references/${file}`,
);

test('the payload manifest lists every file of the CLI-installed skills but the npx-only references, and no other skill', async () => {
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'payload', 'v1', 'payload.json'), 'utf8'));
  const manifestSkillFiles = Object.values(manifest.files)
    .filter((source) => source.startsWith('skills/'))
    .sort();
  const payloadSkillFiles = trackedFiles()
    .filter((file) => PAYLOAD_SKILLS.some((name) => file.startsWith(`skills/${name}/`)) && !NPX_ONLY_FILES.includes(file))
    .sort();

  assert.deepEqual(manifestSkillFiles, payloadSkillFiles);
  for (const file of NPX_ONLY_FILES) assert.ok(trackedFiles().includes(file), `${file} is not shipped`);
  assert.equal(
    trackedFiles().some((file) => file.startsWith('payload/v1/skills/')),
    false,
    'kit skills must live in skills/, not payload/v1/skills/',
  );
});

test('this repository\'s retired workflow skills are gone', () => {
  const tracked = trackedFiles();
  for (const folder of ['.agents/skills', '.claude/skills']) {
    for (const retired of ['plan', 'dev', 'document']) {
      assert.equal(
        tracked.some((file) => file.startsWith(`${folder}/${retired}/`)),
        false,
        `${folder}/${retired} retired with the drakom-* skills`,
      );
    }
  }
});

test('every skill in the AGENTS.md skill table exists', async () => {
  const agents = (await readFile(path.join(repositoryRoot, 'AGENTS.md'), 'utf8')).replaceAll('\r\n', '\n');
  const section = agents.match(/## 2\. Skill Suite\n([\s\S]*?)(?=\n## )/);
  assert.ok(section, 'no Skill Suite section');
  const names = [...section[1].matchAll(/^\| `[/$]?([\w-]+)`/gm)].map(([, name]) => name);
  assert.ok(names.length > 0, 'no skills in the table');
  const tracked = trackedFiles();
  for (const name of names) {
    assert.ok(
      tracked.includes(`skills/${name}/SKILL.md`) || tracked.includes(`.agents/skills/${name}/SKILL.md`),
      `AGENTS.md lists ${name}, which is not a skill here`,
    );
  }
});

test('AGENTS.md says how to run one test file', async () => {
  const agents = (await readFile(path.join(repositoryRoot, 'AGENTS.md'), 'utf8')).replaceAll('\r\n', '\n');
  const section = agents.match(/## 3\. Key Verification Commands\n([\s\S]*?)(?=\n## )/);
  assert.ok(section, 'no Key Verification Commands section');
  assert.match(section[1], /`pnpm build && node --test <file>`/);
});

const REVIEW_DIR = 'skills/drakom-review';

/** Every Markdown file of the review skill, keyed by its path inside the skill folder. */
async function reviewSkillFiles() {
  const files = new Map();
  for (const file of trackedFiles().filter((tracked) => tracked.startsWith(`${REVIEW_DIR}/`))) {
    files.set(file.slice(REVIEW_DIR.length + 1), await readFile(path.join(repositoryRoot, file), 'utf8'));
  }
  return files;
}

test('the review skill states its rules in one short file, with only the GitHub layout beside it', async () => {
  const files = await reviewSkillFiles();

  assert.deepEqual([...files.keys()].sort(), ['SKILL.md', 'references/github-review.md']);
  const lines = (files.get('SKILL.md') ?? '').replaceAll('\r\n', '\n').trimEnd().split('\n');
  assert.ok(lines.length <= 90, `SKILL.md has ${lines.length} lines; keep it to 90`);
});

test('the review skill stands alone: it names no file in another skill or a repo file it has no default for', async () => {
  const text = [...(await reviewSkillFiles()).values()].join('\n');

  assert.doesNotMatch(text, /skills\/(?!drakom-review\b)[\w-]+\//, 'names a file in another skill folder');
  assert.doesNotMatch(text, /\.(agents|claude)\/skills\//, 'names an installed skill folder');
  // Repo files the skill reads, each with a default when it is missing (see "Repo facts and defaults"),
  // and the rules folder whose changes it judges against the base branch.
  const repoFacts = new Set([
    '.drakom-ai/plans/',
    '.drakom-ai/rules/',
    '.drakom-ai/rules/README.md',
    '.drakom-ai/rules/review.md',
    '.drakom-ai/rules/verification.md',
    '.github/',
    'AGENTS.md',
    'CLAUDE.md',
  ]);
  const named = new Set(
    [...text.matchAll(/`((?:\.[\w-]+\/)[^`\s]*|[A-Z]+\.md)`/g)].map(([, file]) => file).filter((file) => file !== 'SKILL.md'),
  );
  assert.deepEqual([...named].sort(), [...repoFacts].sort());
});

test('the review skill gives a default for each repo fact a repo may lack', async () => {
  const skill = (await reviewSkillFiles()).get('SKILL.md') ?? '';

  const section = skill.match(/## Repo facts and defaults\n([\s\S]*?)(?=\n## |$)/);
  assert.ok(section, 'no "Repo facts and defaults" section');
  for (const fact of [/review rules/i, /verification commands/i, /risk labels/i]) {
    assert.match(section[1], fact);
  }
});

test('the review skill acts as if no earlier kit version existed', async () => {
  const text = [...(await reviewSkillFiles()).values()].join('\n');

  assert.ok(text.length > 0, 'the review skill is missing');
  for (const pattern of [/\bCLI\b/, /state\.json/, /drakom-ai sync/, /\b0\.6\.0\b/, /payload/i]) {
    assert.doesNotMatch(text, pattern);
  }
});

test('the review skill offers the kit\'s default risk labels', async () => {
  const skill = (await reviewSkillFiles()).get('SKILL.md') ?? '';

  const item = skill.match(/^- \*\*Risk labels:\*\*([\s\S]*?)(?=\n- |\n\n)/m);
  assert.ok(item, 'no "Risk labels" item');
  const labels = [...item[1].matchAll(/\*\*([^*]+)\*\*/g)].map(([, label]) => label);
  assert.deepEqual(labels, ['credentials', 'user data', 'agent instructions', 'weakens a check', 'other code']);
});

test('the review report gives what a posted review needs', async () => {
  const skill = (await reviewSkillFiles()).get('SKILL.md') ?? '';

  const report = skill.replaceAll('\r\n', '\n').match(/\*\*Report:\*\*\n([\s\S]*?)(?=\n\n)/);
  assert.ok(report, 'no report step');
  const items = new Map(
    [...report[1].matchAll(/^ +- (\w+): ([\s\S]*?)(?=\n +- |(?![\s\S]))/gm)].map(([, name, text]) => [name, text.replace(/\s+/g, ' ')]),
  );

  assert.deepEqual(
    [...items.keys()],
    ['Recommendation', 'Goal', 'Reviewed', 'Risk', 'Review', 'Reviewer', 'Findings', 'Verification'],
  );
  assert.match(items.get('Reviewed') ?? '', /not read/);
  assert.match(items.get('Reviewer') ?? '', /family and tier/);
  assert.doesNotMatch(items.get('Reviewer') ?? '', /effort/);
  for (const part of [/short title/, /line range/, /exact replacement lines/, /every input/]) {
    assert.match(items.get('Findings') ?? '', part);
  }
});

test('the review skill names the cheap tier by rule, not by model, apart from Claude\'s haiku default', async () => {
  const text = [...(await reviewSkillFiles()).values()].join('\n');

  assert.match(text, /cheap tier/);
  assert.match(text, /never the tool's default/);
  for (const model of [/\bgpt-/i, /\bgemini-/i, /\bclaude-/i, /\bluna\b/i, /\bhydrogen\b/i, /\bterra\b/i, /\bsonnet\b/i, /\bopus\b/i]) {
    assert.doesNotMatch(text, model);
  }
});

test('the PR templates keep the Risk line to the level and the label names', async () => {
  for (const file of ['.github/pull_request_template.md', 'skills/drakom-pr/references/pull_request_template.md']) {
    const template = (await readFile(path.join(repositoryRoot, file), 'utf8')).replace(/\s+/g, ' ');

    assert.match(template, /The Risk line is a quick eye catch: the level and the label names, nothing more\./, file);
    assert.match(template, /Paths and reasons go in Reviewer focus\./, file);
  }
});

const HANDOFF_DIR = 'skills/drakom-handoff';

/** The handoff skill's SKILL.md, or an empty string when it is missing. */
async function handoffSkill() {
  const file = `${HANDOFF_DIR}/SKILL.md`;
  if (!trackedFiles().includes(file)) return '';
  return (await readFile(path.join(repositoryRoot, file), 'utf8')).replaceAll('\r\n', '\n');
}

test('the handoff skill is one short file', async () => {
  const files = trackedFiles().filter((file) => file.startsWith(`${HANDOFF_DIR}/`));

  assert.deepEqual(files, [`${HANDOFF_DIR}/SKILL.md`]);
  const lines = (await handoffSkill()).trimEnd().split('\n');
  assert.ok(lines.length <= 30, `SKILL.md has ${lines.length} lines; keep it to 30`);
});

test('the handoff skill stands alone: it names no other skill file and only repo files it can do without', async () => {
  const text = await handoffSkill();

  assert.ok(text.length > 0, 'the handoff skill is missing');
  assert.doesNotMatch(text, /skills\/(?!drakom-handoff\b)[\w-]+\//, 'names a file in another skill folder');
  assert.doesNotMatch(text, /\.(agents|claude)\/skills\//, 'names an installed skill folder');
  const named = new Set(
    [...text.matchAll(/`((?:\.[\w-]+\/)[^`\s]*|[A-Z]+\.md)`/g)].map(([, file]) => file).filter((file) => file !== 'SKILL.md'),
  );
  assert.deepEqual([...named].sort(), ['.drakom-ai/plans/', '.drakom-ai/rules/handoff.md']);
});

test('the handoff skill acts as if no earlier kit version existed', async () => {
  const text = await handoffSkill();

  assert.ok(text.length > 0, 'the handoff skill is missing');
  for (const pattern of [/\bCLI\b/, /state\.json/, /drakom-ai sync/, /\b0\.6\.0\b/, /payload/i]) {
    assert.doesNotMatch(text, pattern);
  }
});

test('the handoff skill prints a prompt to copy, points to what is written down and never creates a plan', async () => {
  const text = (await handoffSkill()).replace(/\s+/g, ' ');

  for (const part of [
    /one fenced block/,
    /in the chat/,
    /by path or URL/,
    /skill the next session should run/,
    /checked/,
    /secrets/,
    /status line/,
    /[Nn]ever create/,
    /fixed list/,
  ]) {
    assert.match(text, part);
  }
});

/** Every kit skill the workflow plans, including those not yet shipped. Longest names first. */
const KIT_SKILL_NAME = /\bdrakom-(?:plan-audit|ai-setup|handoff|review|plan|dev|pr)(?![\w-])/g;

/** Consumer docs that setup copies into a repo. They describe the kit skills; they offer none. */
const CONSUMER_DOCS = ['skills/drakom-ai-setup/references/rules-README.md', 'skills/drakom-ai-setup/references/specs-README.md'];

test('a kit skill offers another kit skill only when that one is installed', async () => {
  for (const file of trackedFiles().filter((tracked) => /^skills\/[^/]+\/.+\.md$/.test(tracked) && !CONSUMER_DOCS.includes(tracked))) {
    const own = file.split('/')[1];
    const text = (await readFile(path.join(repositoryRoot, file), 'utf8')).replaceAll('\r\n', '\n');
    const sentences = text.split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)|(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const others = [...sentence.matchAll(KIT_SKILL_NAME)].map(([name]) => name).filter((name) => name !== own);
      if (others.length > 0) {
        assert.match(sentence, /\binstalled\b/, `${file} names ${others.join(', ')} without "installed": ${sentence.trim()}`);
      }
    }
  }
});

test('the review skill hands off to a fresh session through drakom-handoff when it has no subagents', async () => {
  const skill = ((await reviewSkillFiles()).get('SKILL.md') ?? '').replace(/\s+/g, ' ');

  assert.match(
    skill,
    /Without subagents, offer a fresh session, with `drakom-handoff` writing its prompt when installed; if declined, review it yourself and say so\./,
  );
});

const DEV_DIR = 'skills/drakom-dev';

/** The dev skill's SKILL.md, or an empty string when it is missing. */
async function devSkill() {
  const file = `${DEV_DIR}/SKILL.md`;
  if (!trackedFiles().includes(file)) return '';
  return (await readFile(path.join(repositoryRoot, file), 'utf8')).replaceAll('\r\n', '\n');
}

test('the dev skill is one short file', async () => {
  const files = trackedFiles().filter((file) => file.startsWith(`${DEV_DIR}/`));

  assert.deepEqual(files, [`${DEV_DIR}/SKILL.md`]);
  const lines = (await devSkill()).trimEnd().split('\n');
  assert.ok(lines.length <= 40, `SKILL.md has ${lines.length} lines; keep it to 40`);
});

test('the dev skill stands alone: it names no other skill file and only repo files it can do without', async () => {
  const text = await devSkill();

  assert.ok(text.length > 0, 'the dev skill is missing');
  assert.doesNotMatch(text, /skills\/(?!drakom-dev\b)[\w-]+\//, 'names a file in another skill folder');
  assert.doesNotMatch(text, /\.(agents|claude)\/skills\//, 'names an installed skill folder');
  const named = new Set(
    [...text.matchAll(/`((?:\.[\w-]+\/)[^`\s]*|[A-Z]+\.md)`/g)].map(([, file]) => file).filter((file) => file !== 'SKILL.md'),
  );
  assert.deepEqual(
    [...named].sort(),
    [
      '.drakom-ai/plans/',
      '.drakom-ai/rules/README.md',
      '.drakom-ai/rules/dev.md',
      '.drakom-ai/rules/review.md',
      '.drakom-ai/rules/verification.md',
      'AGENTS.md',
      'CLAUDE.md',
    ],
  );
});

test('the dev skill gives a default for each repo fact a repo may lack', async () => {
  const skill = await devSkill();

  const section = skill.match(/## Repo facts and defaults\n([\s\S]*?)(?=\n## |$)/);
  assert.ok(section, 'no "Repo facts and defaults" section');
  const text = section[1].replace(/\s+/g, ' ');
  for (const fact of [/verification commands/i, /one test/i, /review rules/i, /recent `git log`/]) {
    assert.match(text, fact);
  }
  assert.match(text, /`\.drakom-ai\/rules\/verification\.md` when present/, 'verification.md must stay optional');
});

test('the dev skill acts as if no earlier kit version existed', async () => {
  const text = await devSkill();

  assert.ok(text.length > 0, 'the dev skill is missing');
  for (const pattern of [/\bCLI\b/, /state\.json/, /drakom-ai sync/, /\b0\.6\.0\b/, /payload/i]) {
    assert.doesNotMatch(text, pattern);
  }
});

test('the dev skill keeps the kit steps, which a repo\'s rules add to but cannot remove', async () => {
  const text = (await devSkill()).replace(/\s+/g, ' ');

  for (const part of [
    /one pull request/,
    /propose a split/,
    /see it fail/,
    /least code/,
    /verification commands/,
    /[Nn]ever report a failing or skipped run as passing/,
    /whole diff/,
    /changed files, each check and its result, what is left, and the part most worth a person's look/,
    /[Dd]on't commit or push unless/,
    /status line/,
    /[Nn]ever create a plan/,
    /without a yes/,
    /`drakom-review`/,
    /`drakom-handoff`/,
    /fresh session/,
  ]) {
    assert.match(text, part);
  }
  assert.match(text, /`\.drakom-ai\/rules\/dev\.md` add to these steps and cannot remove/);
});

test('the review risk check classifies the whole change on every review, re-reviews included', async () => {
  const files = await reviewSkillFiles();
  const skill = (files.get('SKILL.md') ?? '').replace(/\s+/g, ' ');
  const reference = (files.get('references/github-review.md') ?? '').replace(/\s+/g, ' ');

  assert.match(skill, /On a re-review too, classify the whole change\./);
  assert.doesNotMatch(skill, /classify only the changes since/);
  assert.match(skill, /Report the last round's risk\./, 'every round classifies the whole change, so the last one is current');
  assert.doesNotMatch(skill, /highest risk any round/);
  const beforeCheck = reference.match(/Until the blind risk check is done, ([^.]*)\./);
  assert.ok(beforeCheck, 'no "Until the blind risk check is done" sentence');
  assert.doesNotMatch(beforeCheck[1], /re-review|marker/, 'the check needs no earlier review, so nothing about one is read before it');
});

const PLAN_DIR = 'skills/drakom-plan';

/** The plan skill's SKILL.md, or an empty string when it is missing. */
async function planSkill() {
  const file = `${PLAN_DIR}/SKILL.md`;
  if (!trackedFiles().includes(file)) return '';
  return (await readFile(path.join(repositoryRoot, file), 'utf8')).replaceAll('\r\n', '\n');
}

test('the plan skill is one short file', async () => {
  const files = trackedFiles().filter((file) => file.startsWith(`${PLAN_DIR}/`));

  assert.deepEqual(files, [`${PLAN_DIR}/SKILL.md`]);
  const lines = (await planSkill()).trimEnd().split('\n');
  assert.ok(lines.length <= 65, `SKILL.md has ${lines.length} lines; keep it to 65`);
});

test('the plan skill stands alone: it names no other skill file and only repo files it can do without', async () => {
  const text = await planSkill();

  assert.ok(text.length > 0, 'the plan skill is missing');
  assert.doesNotMatch(text, /skills\/(?!drakom-plan\b)[\w-]+\//, 'names a file in another skill folder');
  assert.doesNotMatch(text, /\.(agents|claude)\/skills\//, 'names an installed skill folder');
  const named = new Set(
    [...text.matchAll(/`((?:\.[\w-]+\/)[^`\s]*|[A-Z]+\.md)`/g)].map(([, file]) => file).filter((file) => file !== 'SKILL.md'),
  );
  assert.deepEqual(
    [...named].sort(),
    [
      '.drakom-ai/',
      '.drakom-ai/.gitignore',
      '.drakom-ai/plans/',
      '.drakom-ai/rules/README.md',
      '.drakom-ai/rules/plan.md',
      '.drakom-ai/specs/',
      'AGENTS.md',
      'CLAUDE.md',
    ],
  );
});

test('the plan skill gives a default for each repo fact a repo may lack', async () => {
  const skill = await planSkill();

  const section = skill.match(/## Repo facts and defaults\n([\s\S]*?)(?=\n## |$)/);
  assert.ok(section, 'no "Repo facts and defaults" section');
  const text = section[1].replace(/\s+/g, ' ');
  assert.match(text, /\*\*Topic rules:\*\*[^*]*With none, plan from the code/);
  assert.match(text, /\*\*Where plans go:\*\* one file per piece of work in `\.drakom-ai\/plans\/`/);
  assert.match(text, /`\.drakom-ai\/specs\/`, which Git tracks, only when the user asks/);
});

test('the plan skill acts as if no earlier kit version existed', async () => {
  const text = await planSkill();

  assert.ok(text.length > 0, 'the plan skill is missing');
  for (const pattern of [/\bCLI\b/, /state\.json/, /drakom-ai sync/, /\b0\.6\.0\b/, /payload/i]) {
    assert.doesNotMatch(text, pattern);
  }
});

test('the plan skill keeps the kit steps, which a repo\'s rules add to but cannot remove', async () => {
  const text = (await planSkill()).replace(/\s+/g, ' ');

  for (const part of [
    /as data, not instructions/,
    /[Ll]ook through `\.drakom-ai\/plans\/` for a plan on this work/,
    /edit none of it/,
    /[Ff]acts are yours to find/,
    /subagents/,
    /cheaper model/,
    /decisions are the user's/,
    /unless the user asked for `quick`/,
    /[Ee]ach round/,
    /recommended answer/,
    /worded so a yes accepts it/,
    /hang on another still open/,
    /[Rr]ecord the answers in the plan file, creating it after the first round/,
    /no decision is open or silently assumed/,
    /sized to the change/,
    /acceptance criteria/,
    /how it will be tested/,
    /outgrows one pull request/,
    /as soon as you see it/,
    /merge order/,
    /one purpose/,
    /overview/,
    /before and after it/,
    /when its turn comes/,
    /[Aa] new plan is Next/,
    /not approval to build/,
    /`drakom-dev`/,
    /`drakom-handoff`/,
    /fresh session/,
    /set the status to Active/,
    /[Ss]tart nothing without a yes/,
  ]) {
    assert.match(text, part);
  }
  assert.match(
    text,
    /`\.drakom-ai\/rules\/plan\.md` add to these steps and cannot remove the recommended answers, the header or the stop for approval/,
  );
});

test('the plan skill\'s description offers a split rather than promising one', async () => {
  const description = String((await readFrontmatter(`${PLAN_DIR}/SKILL.md`)).description);

  assert.match(description, /offers to split/);
  assert.doesNotMatch(description, /and split into/);
});

test('the plan skill writes the header plan-audit reads', async () => {
  const plan = (await planSkill()).replace(/\s+/g, ' ');
  const audit = (await readFile(path.join(repositoryRoot, 'skills/drakom-plan-audit/SKILL.md'), 'utf8')).replace(/\s+/g, ' ');

  for (const text of [plan, audit]) {
    assert.match(text, /`\*\*Status:\*\* <word>: <one line/);
    assert.match(text, /`\*\*Synopsis:\*\*/);
    assert.match(text, /Active, Next, Later,? or Done/);
  }
});

const PLAN_AUDIT_DIR = 'skills/drakom-plan-audit';

/** The plan-audit skill's SKILL.md, or an empty string when it is missing. */
async function planAuditSkill() {
  const file = `${PLAN_AUDIT_DIR}/SKILL.md`;
  if (!trackedFiles().includes(file)) return '';
  return (await readFile(path.join(repositoryRoot, file), 'utf8')).replaceAll('\r\n', '\n');
}

test('the plan-audit skill is one short file', async () => {
  const files = trackedFiles().filter((file) => file.startsWith(`${PLAN_AUDIT_DIR}/`));

  assert.deepEqual(files, [`${PLAN_AUDIT_DIR}/SKILL.md`]);
  const lines = (await planAuditSkill()).trimEnd().split('\n');
  assert.ok(lines.length <= 40, `SKILL.md has ${lines.length} lines; keep it to 40`);
});

test('the plan-audit skill stands alone: it names no other skill file and only plan and spec folders', async () => {
  const text = await planAuditSkill();

  assert.ok(text.length > 0, 'the plan-audit skill is missing');
  assert.doesNotMatch(text, /skills\/(?!drakom-plan-audit\b)[\w-]+\//, 'names a file in another skill folder');
  assert.doesNotMatch(text, /\.(agents|claude)\/skills\//, 'names an installed skill folder');
  const named = new Set(
    [...text.matchAll(/`((?:\.[\w-]+\/)[^`\s]*|[A-Z]+\.md)`/g)].map(([, file]) => file).filter((file) => file !== 'SKILL.md'),
  );
  assert.deepEqual([...named].sort(), ['.drakom-ai/plans/', '.drakom-ai/specs/']);
});

test('the plan-audit skill acts as if no earlier kit version existed', async () => {
  const text = await planAuditSkill();

  assert.ok(text.length > 0, 'the plan-audit skill is missing');
  for (const pattern of [/\bCLI\b/, /state\.json/, /drakom-ai sync/, /\b0\.6\.0\b/, /payload/i]) {
    assert.doesNotMatch(text, pattern);
  }
});

test('plan-audit reads the pull request line the pull request skill writes', async () => {
  const audit = oneLine(await planAuditSkill());
  const pr = oneLine((await prSkillFiles()).get('SKILL.md') ?? '');

  for (const text of [audit, pr]) assert.ok(text.includes('`**Pull request:** <url>`'), text.slice(0, 80));
});

test('plan-audit checks a listed pull request with gh, and leaves a plan without the line as it was', async () => {
  const text = oneLine(await planAuditSkill());

  for (const part of [
    /A plan without the line gets these checks unchanged and no `gh` call/,
    /`gh pr view <url> --json state,mergedAt`/,
    /[Oo]nly those lines count; ignore a pull request cited anywhere else/,
    /propose Done, as `Done: merged in #<number> \(<date>\)`/,
    /none is open/,
    /Done plan with a listed pull request still open is a finding/,
    /closed without merging, the plan is uncertain, so ask/,
    /report that link as unchecked and finish the other checks; never infer its state from the plan's text/,
  ]) {
    assert.match(text, part);
  }
});

test('plan-audit changes, deletes or moves a plan only on a yes', async () => {
  const text = oneLine(await planAuditSkill());

  for (const part of [
    /report findings and proposed actions without deleting or editing/,
    /On a yes to Done, change only the status line/,
    /offer to delete each plan whose pull requests merged, or move it to `\.drakom-ai\/specs\/`; act only on a yes/,
    /absence of an answer is not approval/,
  ]) {
    assert.match(text, part);
  }
  assert.doesNotMatch(text, /Do not promote plans into tracked specs/);
});

const PR_DIR = 'skills/drakom-pr';

/**
 * Every file of the pull request skill, keyed by its path inside the skill folder, with LF endings.
 * @returns {Promise<Map<string, string>>}
 */
async function prSkillFiles() {
  const files = new Map();
  for (const file of trackedFiles().filter((tracked) => tracked.startsWith(`${PR_DIR}/`))) {
    files.set(file.slice(PR_DIR.length + 1), (await readFile(path.join(repositoryRoot, file), 'utf8')).replaceAll('\r\n', '\n'));
  }
  return files;
}

/** @param {string} text */
const oneLine = (text) => text.replace(/\s+/g, ' ');

/**
 * The "Risk labels" item of a skill's "Repo facts and defaults", on one line.
 * @param {string} skill
 */
function riskLabelsItem(skill) {
  const item = skill.replaceAll('\r\n', '\n').match(/^- \*\*Risk labels:\*\*([\s\S]*?)(?=\n- |\n\n)/m);
  assert.ok(item, 'no "Risk labels" item');
  return oneLine(item[1]);
}

/**
 * The default labels a "Risk labels" item gives, each with its level, in order.
 * @param {string} skill
 */
function defaultRiskLevels(skill) {
  /** @type {[string, string][]} */
  const levels = [];
  for (const [, group, level] of riskLabelsItem(skill).matchAll(/((?:\*\*[^*]+\*\*(?:, | or )?)+) \((High|Medium)\)/g)) {
    for (const [, label] of group.matchAll(/\*\*([^*]+)\*\*/g)) levels.push([label, level]);
  }
  return levels;
}

/** The starter template's labels, each with the level its Levels list gives it, in label order. */
async function starterRiskLevels() {
  const starter = (await prSkillFiles()).get('references/pull_request_template.md') ?? '';
  const labels = starter.match(/^Risk labels[^\n]*\n((?: {2}[^\n]+\n)+)/m);
  assert.ok(labels, 'the starter has no "Risk labels" list');
  const names = [...labels[1].matchAll(/^ {2}([\w ]+): /gm)].map(([, name]) => name);
  /** @type {Map<string, string>} */
  const byLabel = new Map();
  for (const [, level, text] of starter.matchAll(/^ {2}\S+ (High|Medium|Low): [^.]+\. ([^\n]*(?:\n {4}[^\n]*)*)/gm)) {
    for (const name of names) {
      if (new RegExp(`\\b${name}\\b`, 'i').test(text)) byLabel.set(name, level);
    }
  }
  return names.map((name) => [name, byLabel.get(name) ?? 'none']);
}

test('the pull request skill is one short file, with only the starter template beside it', async () => {
  const files = await prSkillFiles();

  assert.deepEqual([...files.keys()].sort(), ['SKILL.md', 'references/pull_request_template.md']);
  const lines = (files.get('SKILL.md') ?? '').trimEnd().split('\n');
  assert.ok(lines.length <= 75, `SKILL.md has ${lines.length} lines; keep it to 75`);
});

test('the pull request skill stands alone: it names no other skill file and only repo files it can do without', async () => {
  const text = [...(await prSkillFiles()).values()].join('\n');

  assert.ok(text.length > 0, 'the pull request skill is missing');
  assert.doesNotMatch(text, /skills\/(?!drakom-pr\b)[\w-]+\//, 'names a file in another skill folder');
  assert.doesNotMatch(text, /\.(agents|claude)\/skills\//, 'names an installed skill folder');
  const named = new Set(
    [...text.matchAll(/`((?:\.[\w-]+\/)[^`\s]*|[A-Z]+\.md)`/g)].map(([, file]) => file).filter((file) => file !== 'SKILL.md'),
  );
  assert.deepEqual(
    [...named].sort(),
    [
      '.drakom-ai/',
      '.drakom-ai/.gitignore',
      '.drakom-ai/plans/',
      '.drakom-ai/rules/pr.md',
      '.drakom-ai/rules/review.md',
      '.drakom-ai/rules/verification.md',
      '.github/',
      'AGENTS.md',
      'CLAUDE.md',
    ],
  );
});

test('the pull request skill gives a default for each repo fact a repo may lack', async () => {
  const skill = (await prSkillFiles()).get('SKILL.md') ?? '';

  const section = skill.match(/## Repo facts and defaults\n([\s\S]*?)(?=\n## |$)/);
  assert.ok(section, 'no "Repo facts and defaults" section');
  const text = oneLine(section[1]);
  assert.match(
    text,
    /\*\*Template:\*\* `pull_request_template\.md` \(any case, or `\.txt`\) in `\.github\/`, the root or `docs\/`, as GitHub reads it; with none, `references\/pull_request_template\.md` here\./,
  );
  assert.match(text, /\*\*Risk labels:\*\* [^*]*, else \*\*credentials\*\*[\s\S]*Low for the rest\./);
  assert.match(
    text,
    /commit conventions,\*\* the risk-check tier, and any review a pull request needs first: `\.drakom-ai\/rules\/pr\.md`, `\.drakom-ai\/rules\/review\.md`, `AGENTS\.md` or `CLAUDE\.md`; else match the recent `git log`\./,
  );
  assert.match(text, /`\.drakom-ai\/rules\/verification\.md`, when present/, 'verification.md must stay optional');
});

test('the pull request skill acts as if no earlier kit version existed', async () => {
  const text = [...(await prSkillFiles()).values()].join('\n');

  assert.ok(text.length > 0, 'the pull request skill is missing');
  for (const pattern of [/\bCLI\b/, /state\.json/, /drakom-ai sync/, /\b0\.6\.0\b/, /payload/i]) {
    assert.doesNotMatch(text, pattern);
  }
});

test('the pull request skill keeps the kit steps, which a repo\'s rules add to but cannot remove', async () => {
  const text = oneLine((await prSkillFiles()).get('SKILL.md') ?? '');

  for (const part of [
    /`gh auth status`/,
    /GitHub remote/,
    /[Ii]f a pull request is open for this branch, give its link in your reply and stop/,
    /[Oo]n the default branch or with uncommitted changes, say what is needed/,
    /do it on a yes/,
    /record the answer in `\.drakom-ai\/rules\/pr\.md` as one line/,
    /[Tt]he risk result, at the top, after any opening comment, when the template has no place for it/,
    /commit what you wrote, on its own, before the risk check/,
    /[Ww]ith no template and a no, the description still follows the starter/,
    /risk result for the current head, use it and the model that ran it/,
    /[Oo]therwise, once step 2's commit is made and before writing anything else, classify/,
    /[Tt]he diff is the whole change from the base to the head, step 2's commit included\./,
    /[Ww]ithout subagents, classify it yourself first and say it was not blind/,
    /\*\*Before pushing,\*\* ask/,
    /the repo needs a review and none is known for the current head/,
    /an acceptance criterion of the plan or request is not met and nothing records why/,
    /about 1,000 changed lines with no reason given/,
    /`Not done: …, because …`/,
    /[Cc]ount its words outside comments against the budget its opening comment sets, else about 200, and cut to fit/,
    /[Aa] large change may run over, with Reviewer focus kept short/,
    /`gh pr create`, ready for review unless `\.drakom-ai\/rules\/pr\.md` asks for a draft/,
    /`\*\*Pull request:\*\* <url>` as its own paragraph after the header/,
    /update the status line/,
    /[Nn]ever merge, reply on the pull request, resolve its threads, comment on it or edit it once open/,
    /[Gg]ive the link in your reply, not only in tool output\./,
    /[Ss]tart nothing without a yes/,
  ]) {
    assert.match(text, part);
  }
  assert.match(
    text,
    /`\.drakom-ai\/rules\/pr\.md` add to these steps and cannot remove the risk check from the diff alone, the word count, the questions before pushing or the hands-off rule/,
  );
  assert.doesNotMatch(text, /drakom-review/, 'it names no review skill, so it works without one');
});

/** The sentences of the blind risk check that `drakom-pr` and `drakom-review` share word for word. */
const SHARED_RISK_SENTENCES = [
  "classify the diff on the cheap tier the repo's rules name for the tool that runs it, by name, never the tool's default (none named: Claude's `haiku`, else ask). Give it the labels, the diff command and the untracked paths; it reads nothing else and uses only those labels.",
  'One `path:line` per label; when unsure, the higher level.',
];

test('the pull request and review skills run the same risk check, with the same default labels', async () => {
  const review = (await reviewSkillFiles()).get('SKILL.md') ?? '';
  const pr = (await prSkillFiles()).get('SKILL.md') ?? '';

  for (const sentence of SHARED_RISK_SENTENCES) {
    assert.ok(oneLine(review).includes(sentence), `drakom-review lacks: ${sentence}`);
    assert.ok(oneLine(pr).includes(sentence), `drakom-pr lacks: ${sentence}`);
  }
  assert.equal(riskLabelsItem(pr), riskLabelsItem(review));
  assert.match(riskLabelsItem(review), /`pull_request_template\.md` \(any case, or `\.txt`\) in `\.github\/`, the root or `docs\/`/);
});

test('the starter template gives the skills\' default labels and levels, a word budget and a short Risk line', async () => {
  const starter = (await prSkillFiles()).get('references/pull_request_template.md') ?? '';
  const review = (await reviewSkillFiles()).get('SKILL.md') ?? '';
  const pr = (await prSkillFiles()).get('SKILL.md') ?? '';
  const expected = [
    ['credentials', 'High'],
    ['user data', 'High'],
    ['agent instructions', 'Medium'],
    ['weakens a check', 'Medium'],
    ['other code', 'Medium'],
  ];

  assert.deepEqual(await starterRiskLevels(), expected);
  assert.deepEqual(defaultRiskLevels(review), expected);
  assert.deepEqual(defaultRiskLevels(pr), expected);
  assert.match(starter, /^ {2}other code: any other change to code, its dependencies or its build$/m);
  assert.match(oneLine(starter), /About 200 words outside these comments/);
  for (const rule of [/Say what a user would see\./, /Name the checks CI runs only when one couldn't run/, /With no label, write "No label"\./, /Every level still needs a person's approval\./, /`path:line`/, /what a revert leaves behind/, /"Not covered:"/]) {
    assert.match(oneLine(starter), rule);
  }

  const risk = starter.match(/^## Risk\n\n([^\n]+)\n/m);
  assert.ok(risk, 'the starter has no visible "## Risk" heading with a Risk line under it');
  const line = risk[1].match(/^(?:🔴|🟡|🟢) \*\*(?:High|Medium|Low): [^*]+\*\* (.+)\.$/);
  assert.ok(line, `the Risk line is not a level: ${risk[1]}`);
  assert.match(risk[1], /^🔴 \*\*High: read closely\.\*\* /, 'like this repo\'s template, the Risk line starts at High');
  const names = expected.map(([name]) => name.toLowerCase());
  for (const label of line[1].split(/, /)) {
    assert.ok(label === 'No label' || names.includes(label.toLowerCase()), `the Risk line holds more than label names: ${label}`);
  }
});

/** How every loop skill offers its next step, word for word. */
const HERE_OR_FRESH = 'here or in a fresh session started from a `drakom-handoff` prompt, each when installed, and recommend one in a few words';

test('every loop skill offers its next step here or in a fresh session in the same words', async () => {
  for (const name of ['drakom-dev', 'drakom-plan', 'drakom-review', 'drakom-pr']) {
    const skill = await readFile(path.join(repositoryRoot, `skills/${name}/SKILL.md`), 'utf8').catch(() => '');
    assert.ok(oneLine(skill).includes(HERE_OR_FRESH), `${name} does not offer its next step in the shared words`);
  }
});

test('the review skill ends every run by offering what has not run, drakom-pr among them', async () => {
  const skill = oneLine((await reviewSkillFiles()).get('SKILL.md') ?? '');

  assert.match(
    skill,
    /At the end of every run, offer what fits and has not run: fix rounds for important findings, posting for a pull request, or `drakom-pr` when nothing important is open and there is no pull request yet, here or in a fresh session/,
  );
  assert.doesNotMatch(skill, /When neither `fix` nor `post` was passed/, 'the offer covers fix runs too');
  assert.doesNotMatch(skill, /permissions and hooks/);
  assert.match(skill, /Start nothing without a yes\./);
});

test('the review skill asks about open nits before offering a pull request, and keeps what the cut lines carried', async () => {
  const skill = oneLine((await reviewSkillFiles()).get('SKILL.md') ?? '');

  for (const part of [
    'Before offering to open a pull request, ask the user to fix or leave each open nit, recommending one; those to fix count as important, even past round 3: run a round.',
    '"No findings" is a valid result',
    'Nits and bugs the change did not introduce are listed, not fixed',
    'A repo can change this in `.drakom-ai/rules/review.md`',
    'not push, post, comment or edit the pull request',
  ]) {
    assert.ok(skill.includes(part), `drakom-review does not say: ${part}`);
  }
});

test('every summary of drakom-review fix that caps the rounds at three names the nit exception', async () => {
  const read = async (/** @type {string} */ file) => (await readFile(path.join(repositoryRoot, file), 'utf8')).replaceAll('\r\n', '\n');
  const summaries = new Map([
    ['the skill frontmatter', String((await readFrontmatter('skills/drakom-review/SKILL.md')).description)],
    ['README.md', (await read('README.md')).split('\n').find((line) => line.startsWith('| `drakom-review` |')) ?? ''],
    ['AGENTS.md', (await read('AGENTS.md')).split('\n').find((line) => line.startsWith('| `/drakom-review` |')) ?? ''],
    ['.changeset/drakom-review.md', await read('.changeset/drakom-review.md')],
  ]);

  for (const [where, text] of summaries) {
    assert.match(text, /up to three/, `${where} no longer summarizes drakom-review fix`);
    for (const [cap] of text.matchAll(/up to three[^,.]*/g)) {
      assert.ok(
        text.includes(`${cap}, more only for nits you choose to fix`),
        `${where} says "${cap}" without the nit exception`,
      );
    }
  }
});

const SETUP_STEP = /^## Setting up `\.drakom-ai\/`\n([\s\S]*?)(?=\n## |(?![\s\S]))/m;

test('every kit skill that names .drakom-ai/.gitignore carries the same setup step', async () => {
  /** @type {Map<string, string>} */
  const copies = new Map();
  for (const file of trackedFiles().filter((tracked) => /^skills\/[^/]+\/SKILL\.md$/.test(tracked))) {
    const text = (await readFile(path.join(repositoryRoot, file), 'utf8')).replaceAll('\r\n', '\n');
    const step = text.match(SETUP_STEP);
    if (step) copies.set(file, step[1].trim());
    else assert.doesNotMatch(text, /`\.drakom-ai\/\.gitignore`/, `${file} names .drakom-ai/.gitignore without the setup step`);
  }

  assert.ok(copies.has(`${PLAN_DIR}/SKILL.md`), 'the plan skill has no "Setting up `.drakom-ai/`" section');
  assert.ok(copies.has(`${PR_DIR}/SKILL.md`), 'the pull request skill has no "Setting up `.drakom-ai/`" section');
  assert.ok(copies.has('skills/drakom-ai-setup/SKILL.md'), 'the setup skill has no "Setting up `.drakom-ai/`" section');
  const [first, ...rest] = [...copies.entries()];
  for (const [file, step] of rest) {
    assert.equal(step, first[1], `${file}'s setup step differs from ${first[0]}'s`);
  }
  const step = first[1].replace(/\s+/g, ' ');
  assert.match(step, /create only what is missing and change nothing that exists/);
  assert.match(step, /under `\.drakom-ai\/` at the repository root/, 'the step must say where .drakom-ai/ goes');
  assert.match(step, /run from the repository root/, 'the check gives a false failure from a subdirectory');
  assert.match(step, /stop and tell the user, and edit no ignore file/);
});

test('in an empty repository the setup step adds only .drakom-ai/.gitignore, and its check catches a plan Git would track', async (t) => {
  const step = ((await planSkill()).match(SETUP_STEP)?.[1] ?? '').replace(/\s+/g, ' ');
  const ignoreLines = step.match(/`\.drakom-ai\/\.gitignore` holding the two lines `([^`]+)` and `([^`]+)`/);
  const check = step.match(/In a Git repository, `(git check-ignore [^`]+)` must then succeed/);
  assert.ok(ignoreLines, 'the step does not give the .gitignore contents');
  assert.ok(check, 'the step does not give the check-ignore command');
  const [, ...checkArgs] = check[1].split(' ');

  const root = await mkdtemp(path.join(os.tmpdir(), 'drakom-plan-setup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // An empty excludes file keeps the developer's own global ignores out of the result.
  const noGlobalIgnores = path.join(root, 'no-global-ignores');
  const repo = path.join(root, 'repo');
  await writeFile(noGlobalIgnores, '');
  await mkdir(path.join(repo, '.drakom-ai', 'plans'), { recursive: true });
  const git = (/** @type {string[]} */ ...args) =>
    spawnSync('git', ['-c', `core.excludesFile=${noGlobalIgnores}`, ...args], { cwd: repo, encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);

  await writeFile(path.join(repo, '.drakom-ai', '.gitignore'), `${ignoreLines[1]}\n${ignoreLines[2]}\n`);
  await writeFile(path.join(repo, '.drakom-ai', 'plans', 'some-work.md'), '# Some work\n');
  const status = git('status', '--porcelain', '--untracked-files=all');
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.stdout, '?? .drakom-ai/.gitignore\n');
  assert.equal(git(...checkArgs).status, 0, 'the check fails on the .gitignore the step writes');
  // A repo may already track a file under plans/, such as an old plan; new plans are still ignored.
  assert.equal(git('add', '--force', '.drakom-ai/plans/some-work.md').status, 0);
  assert.equal(git(...checkArgs).status, 0, 'a plan already in the index fails the check');

  await writeFile(path.join(repo, '.drakom-ai', '.gitignore'), `${ignoreLines[2]}\n`);
  assert.equal(git(...checkArgs).status, 1, 'the check passes when plans are not ignored');
});

const SETUP_DIR = 'skills/drakom-ai-setup';

/**
 * Every file of the setup skill, keyed by its path inside the skill folder, with LF endings.
 * @returns {Promise<Map<string, string>>}
 */
async function setupSkillFiles() {
  const files = new Map();
  for (const file of trackedFiles().filter((tracked) => tracked.startsWith(`${SETUP_DIR}/`))) {
    files.set(file.slice(SETUP_DIR.length + 1), (await readFile(path.join(repositoryRoot, file), 'utf8')).replaceAll('\r\n', '\n'));
  }
  return files;
}

/**
 * One numbered step of a skill's "Steps", on one line, found by its bold name.
 * @param {string} skill
 * @param {string} name
 */
function step(skill, name) {
  const match = skill.match(new RegExp(`^\\d+\\. \\*\\*${name}[.,]?\\*\\*[\\s\\S]*?(?=\\n\\d+\\. |\\n## |(?![\\s\\S]))`, 'm'));
  assert.ok(match, `no "${name}" step`);
  return oneLine(match[0]);
}

test('the setup skill is one short file, with its references beside it', async () => {
  const files = await setupSkillFiles();

  assert.deepEqual([...files.keys()].sort(), [
    'SKILL.md',
    'references/assessment-plan-template.md',
    'references/pull_request_template.md',
    'references/rule-anatomy.md',
    'references/rules-README.md',
    'references/rules-audit.md',
    'references/specs-README.md',
  ]);
  const lines = (files.get('SKILL.md') ?? '').trimEnd().split('\n');
  assert.ok(lines.length <= 90, `SKILL.md has ${lines.length} lines; keep it to 90`);
});

test('the setup skill stands alone: it names only its own references and the repo files it reads or offers', async () => {
  const files = await setupSkillFiles();
  const skill = files.get('SKILL.md') ?? '';
  const text = [...files.values()].join('\n');

  assert.doesNotMatch(text, /skills\/(?!drakom-ai-setup\b)[\w-]+\//, 'names a file in another skill folder');
  assert.doesNotMatch(text, /\.(agents|claude)\/skills\/drakom-/, 'names an installed kit skill');
  const references = new Set([...skill.matchAll(/`references\/([^`<]+)`/g)].map(([, file]) => `references/${file}`));
  assert.deepEqual(
    [...references].sort(),
    [...files.keys()].filter((file) => file.startsWith('references/')).sort(),
    'SKILL.md names each reference it ships, and only those',
  );
  const named = new Set(
    [...skill.matchAll(/`((?:\.[\w-]+\/)[^`\s]*|[A-Z]+\.md)`/g)].map(([, file]) => file).filter((file) => file !== 'SKILL.md'),
  );
  assert.deepEqual(
    [...named].sort(),
    [
      '.agents/skills/',
      '.claude/skills/',
      '.drakom-ai/',
      '.drakom-ai/.gitignore',
      '.drakom-ai/assets/*',
      '.drakom-ai/plans/',
      '.drakom-ai/plans/*',
      '.drakom-ai/rules/',
      '.drakom-ai/rules/README.md',
      '.drakom-ai/rules/pr.md',
      '.drakom-ai/specs/',
      '.drakom-ai/specs/README.md',
      '.github/',
      'AGENTS.md',
      'CLAUDE.md',
      'CONTRIBUTING.md',
    ],
  );
});

test('the setup skill reads repo facts in the kit\'s order, with a default for each', async () => {
  const skill = (await setupSkillFiles()).get('SKILL.md') ?? '';

  const section = skill.match(/## Repo facts and defaults\n([\s\S]*?)(?=\n## |$)/);
  assert.ok(section, 'no "Repo facts and defaults" section');
  const text = oneLine(section[1]);
  assert.match(text, /`\.drakom-ai\/rules\/`, then `AGENTS\.md` and `CLAUDE\.md` at the root and nearest each part of the code, then package scripts, Makefile or CI/);
  assert.match(text, /never user-level settings without a yes/);
  assert.match(text, /[Ll]ist `\.drakom-ai\/plans\/` and `\.drakom-ai\/specs\/` by folder, since search tools skip ignored files/);
  assert.match(text, /\*\*Topic rules:\*\* those that `\.drakom-ai\/rules\/README\.md`, `AGENTS\.md` or `CLAUDE\.md` route to/);
  assert.match(text, /[Ww]ith none, there are none/);
});

test('the setup skill acts as if no earlier kit version existed', async () => {
  const text = [...(await setupSkillFiles()).values()].join('\n');

  assert.ok(text.length > 0, 'the setup skill is missing');
  for (const pattern of [
    /\bCLI\b/,
    /state\.json/,
    /\bsync\b/,
    /\bMCP\b/i,
    /\b0\.6\.0\b/,
    /payload/i,
    /managed block/i,
    /drakom-ai:(start|end)/,
    /kit-managed/,
    /drakom-ai (init|sync)/,
    /skill-author/,
    /legacy/i,
  ]) {
    assert.doesNotMatch(text, pattern);
  }
});

test('the setup skill creates only the folders, then offers everything else and writes it only on a yes', async () => {
  const skill = (await setupSkillFiles()).get('SKILL.md') ?? '';

  const folders = step(skill, 'Folders');
  assert.match(folders, /[Dd]o "Setting up `\.drakom-ai\/`" below/);
  assert.match(folders, /`\.drakom-ai\/rules\/README\.md` from `references\/rules-README\.md`/);
  assert.match(folders, /`\.drakom-ai\/specs\/README\.md` from `references\/specs-README\.md`/);
  assert.match(folders, /each only when missing/);
  assert.match(folders, /[Ww]rite nothing in `plans\/` or `assets\/`/);

  const offers = step(skill, 'Offers');
  for (const part of [
    /in one round in chat/,
    /[Ww]rite each only on a yes; leave every file outside `\.drakom-ai\/` unchanged without one\. Never commit\./,
    /`AGENTS\.md`, when missing, holding only facts found here, and for Claude users `@AGENTS\.md` in `CLAUDE\.md`/,
    /[Ww]ith only a `CLAUDE\.md`, offer the pointer line there and move nothing/,
    /``Project rules for agents: `\.drakom-ai\/rules\/README\.md`\.``/,
    /never an `@` import/,
    /`\.worktreeinclude` at the root with `\.drakom-ai\/plans\/\*` and `\.drakom-ai\/assets\/\*`, for Claude Code to copy the ignored plans and assets into new worktrees/,
    /add only the missing lines/,
    /offer to move or point to the verification commands and review rules/,
    /[Pp]ropose lines for `\.drakom-ai\/rules\/pr\.md` only for a draft habit, or pull request and commit conventions outside `AGENTS\.md` and `CLAUDE\.md`/,
    /[Aa] route for each topic rule in `\.drakom-ai\/rules\/` that has none, never an extension file/,
    /[Aa]n existing README without the "Topic rules" or "Extension files" section: offer it from `references\/rules-README\.md`, in the same offer as any route that needs it/,
    /keep both, rename theirs or remove theirs/,
    /[Cc]hange none/,
  ]) {
    assert.match(offers, part);
  }
});

test('the setup skill recommends, stops for approval, then applies and verifies only what was approved', async () => {
  const skill = (await setupSkillFiles()).get('SKILL.md') ?? '';
  const text = oneLine(skill);

  const recommend = step(skill, 'Recommend');
  for (const category of ['Keep', 'Refine', 'Add', 'Omit']) assert.match(recommend, new RegExp(`\\*\\*${category}:\\*\\*`));
  for (const part of [
    /`references\/rule-anatomy\.md`/,
    /suggested skill, its name and a one-line purpose, never written/,
    /Omit never means delete/,
    /never install a fixed set/,
    /ownership \(project-owned, kit skill or unknown\)/,
    /dependencies \(routes, scripts, companion files\)/,
    /[Ww]ith Add or Refine items, draft the plan in `\.drakom-ai\/plans\/` from `references\/assessment-plan-template\.md`/,
    /[Ii]n every mode, name a secret found in the repo by its path or variable, never its value, in files, reports and logs/,
  ]) {
    assert.match(recommend, part);
  }
  assert.match(step(skill, 'Approval'), /[Ss]top and ask before creating or changing any rule or instruction file/);
  const apply = step(skill, 'Apply and verify');
  assert.match(apply, /route it where the repo already routes rules, else in the README's "Topic rules" list/);
  assert.match(apply, /[Nn]ever move a route unasked/);
  assert.match(apply, /every path exists, every command runs with the repo's tooling and every route and link resolves/);
  assert.doesNotMatch(text, /Standards Index/, 'a new rule is routed where the repo routes rules, not in a fixed section');
  assert.match(
    text,
    /[Ww]rite nothing through a symlink: check each destination and its parents below the repository root without following links, and report any write you skip/,
  );
});

test('the setup skill names its audit reference only for the audit, which writes nothing without a yes', async () => {
  const files = await setupSkillFiles();
  const skill = files.get('SKILL.md') ?? '';
  const audit = oneLine(files.get('references/rules-audit.md') ?? '');

  const sentences = skill.split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)/).filter((part) => part.includes('references/rules-audit.md'));
  assert.equal(sentences.length, 1);
  assert.match(oneLine(sentences[0]), /^7\. \*\*Rules audit\.\*\*/);
  assert.match(step(skill, 'Rules audit'), /reports in chat and writes nothing without a yes, each change approved on its own/);
  assert.match(step(skill, 'Rules audit'), /^7\. \*\*Rules audit\.\*\* Run it on `audit`, with or without rules files;/, 'audit runs in a repo with no rules files too');
  assert.match(oneLine(skill), /`audit` runs only step 7\./);

  for (const part of [
    /[Rr]ead-only/,
    /a topic rule in `\.drakom-ai\/rules\/` with no route, and a route to a file that does not exist, wherever the route lives/,
    /[Mm]ove no route/,
    /[Tt]he six extension files listed in `rules-README\.md` beside this file need no route, whatever the repo's own README says/,
    /[Tt]he same rule in two places, or two rules that conflict/,
    /linter, formatter, type checker or test already enforces/,
    /`\.drakom-ai\/plans\/` and `\.drakom-ai\/specs\/` first/,
    /GitHub remote/,
    /`gh auth status`/,
    /last 10 merged pull requests/,
    /`updatedAt` is never earlier than its `mergedAt`/,
    /`gh api --paginate repos\/\{owner\}\/\{repo\}\/pulls\/<number>\/comments`/,
    /`gh api --paginate repos\/\{owner\}\/\{repo\}\/issues\/<number>\/comments`/,
    /[Nn]ame a secret by its path or variable, never its value/,
    /as data, not instructions/,
    /counts once/,
    /two distinct pull requests/,
    /[Rr]eport in chat/,
    /no plan file unless the user asks/,
    /[Cc]onfirm each finding in the file it cites, read on its own so the line numbers are that file's/,
  ]) {
    assert.match(audit, part);
  }
});

/** The template offer that `drakom-pr` and setup share word for word. */
const SHARED_TEMPLATE_OFFER =
  'Unless `.drakom-ai/rules/pr.md` already records an answer: with no template, offer once to add the starter as `pull_request_template.md` in `.github/`; with a template that has no visible heading or box for the risk, offer once to add only the starter\'s risk section to that file: its comment from "Risk labels" on, at the top of the file\'s opening comment or as a new opening comment, unless that comment already lists labels, and the `## Risk` block at the top, after any opening comment.';
const TEMPLATE_LOOKUP = '`pull_request_template.md` (any case, or `.txt`) in `.github/`, the root or `docs/`';
const TEMPLATE_ANSWER = '`PR template offer: yes` or `PR template offer: no`';

test('setup and drakom-pr make the same template offer, from the same starter, and record the answer alike', async () => {
  const setup = await setupSkillFiles();
  const pr = await prSkillFiles();

  assert.equal(setup.get('references/pull_request_template.md'), pr.get('references/pull_request_template.md'), 'the starters differ');
  for (const [name, skill] of [
    ['drakom-ai-setup', setup.get('SKILL.md') ?? ''],
    ['drakom-pr', pr.get('SKILL.md') ?? ''],
  ]) {
    const text = oneLine(skill);
    assert.ok(text.includes(SHARED_TEMPLATE_OFFER), `${name} lacks the shared template offer`);
    assert.ok(text.includes(TEMPLATE_LOOKUP), `${name} lacks the shared template lookup`);
    assert.ok(text.includes(TEMPLATE_ANSWER), `${name} lacks the shared answer line`);
  }
  assert.match(oneLine(setup.get('SKILL.md') ?? ''), /[Ss]ay first that either answer writes one line in `\.drakom-ai\/rules\/pr\.md`/);
});

/** The extension files in `.drakom-ai/rules/` that the kit skills find by name. */
const EXTENSION_FILES = ['dev.md', 'handoff.md', 'plan.md', 'pr.md', 'review.md', 'verification.md'];

test('the rules README lists every extension file a kit skill names, each optional, with the skills that read it', async () => {
  const readme = (await setupSkillFiles()).get('references/rules-README.md') ?? '';
  /** @type {Map<string, Set<string>>} */
  const readers = new Map();
  for (const file of trackedFiles().filter((tracked) => /^skills\/[^/]+\/.+\.md$/.test(tracked) && !CONSUMER_DOCS.includes(tracked))) {
    const skill = file.split('/')[1];
    const text = await readFile(path.join(repositoryRoot, file), 'utf8');
    for (const [, name] of text.matchAll(/`\.drakom-ai\/rules\/([\w-]+\.md)`/g)) {
      if (name === 'README.md') continue;
      if (!readers.has(name)) readers.set(name, new Set());
      // Setup writes `pr.md`; the others read the files they name.
      if (skill !== 'drakom-ai-setup') readers.get(name)?.add(skill);
    }
  }

  assert.deepEqual([...readers.keys()].sort(), EXTENSION_FILES, 'the kit skills name other extension files');
  const section = readme.match(/^## Extension files\n([\s\S]*?)(?=\n## |(?![\s\S]))/m);
  assert.ok(section, 'no "Extension files" section');
  const extensions = oneLine(section[1]);
  assert.match(extensions, /optional/);
  assert.match(extensions, /find these files by name, with no route/);
  assert.match(extensions, /cannot switch one off/);
  for (const name of EXTENSION_FILES) {
    const item = section[1].match(new RegExp(`^- \`${name.replace('.', '\\.')}\`[\\s\\S]*?(?=\\n- |(?![\\s\\S]))`, 'm'));
    assert.ok(item, `the README does not list ${name}`);
    const line = oneLine(item[0]);
    for (const skill of readers.get(name) ?? []) assert.match(line, new RegExp(`\\b${skill}\\b`), `${name}'s line does not name ${skill}`);
    assert.match(line, /[Ww]ithout it/, `${name}'s line gives no fallback`);
  }
});

test('the rules README says any rule file can go in the folder and starts with an empty "Topic rules" list', async () => {
  const readme = (await setupSkillFiles()).get('references/rules-README.md') ?? '';

  const opening = oneLine(readme.split(/\n## /)[0]);
  assert.match(opening, /[Aa]ny rule file can go in this folder/);
  assert.match(opening, /when something routes to it/);
  assert.match(opening, /a route in `AGENTS\.md` or `CLAUDE\.md`, which works the same/);
  const topics = readme.match(/^## Topic rules\n([\s\S]*?)(?=\n## |(?![\s\S]))/m);
  assert.ok(topics, 'no "Topic rules" section');
  assert.match(oneLine(topics[1]), /`coding\.md`: when writing or changing code/, 'the list says how to write an entry');
  assert.doesNotMatch(topics[1], /^- /m, 'the list starts empty');
});

test('every kit skill that reads topic rules names the rules README as a place routes live', async () => {
  for (const file of trackedFiles().filter((tracked) => /^skills\/[^/]+\/SKILL\.md$/.test(tracked))) {
    const text = oneLine(await readFile(path.join(repositoryRoot, file), 'utf8'));
    if (/topic rules/i.test(text)) assert.match(text, /`\.drakom-ai\/rules\/README\.md`/, file);
  }
});

test('the setup references keep the four categories, the rule anatomy and no fixed route', async () => {
  const files = await setupSkillFiles();
  const assessment = files.get('references/assessment-plan-template.md') ?? '';
  const anatomy = files.get('references/rule-anatomy.md') ?? '';

  for (const heading of ['## Keep', '## Refine', '## Add', '## Omit', '## Approval Gate']) assert.match(assessment, new RegExp(`^${heading}$`, 'm'));
  assert.match(assessment, /Ownership \(project-owned, kit skill or unknown\)/);
  assert.match(assessment, /Omit never means delete/);
  for (const section of ['Scope', 'Required Patterns', 'Prohibited Patterns', 'Verification']) {
    assert.match(anatomy, new RegExp(`\\*\\*${section}\\*\\*`), section);
  }
  assert.match(anatomy, /150 lines/);
  assert.match(
    oneLine(anatomy),
    /`AGENTS\.md` Standards Index, or wherever else the repo already routes rules; where it routes none, to the "Topic rules" list in `\.drakom-ai\/rules\/README\.md`/,
  );
  assert.match(anatomy, /Prohibited Patterns\*\* \(optional\)/);
  assert.match(anatomy, /formatters, linters, types, or tests/i);
  assert.match(anatomy, /^## Worked Example$/m);
  for (const ruleType of ['Coding', 'Testing', 'Documentation', 'Domain risk', 'Security', 'API contracts']) {
    const block = anatomy.match(new RegExp(`^### ${ruleType}\\n([\\s\\S]*?)(?=^##|(?![\\s\\S]))`, 'm'))?.[1] ?? '';
    assert.match(block, /Justified when/i, ruleType);
    assert.match(block, /Skip when/i, ruleType);
  }
  for (const field of [
    'Source path and evidence',
    'Decision and rationale',
    'Destination or action (including "keep in place")',
    'Dependencies (routes, scripts, companion files)',
    'Approval status',
    'Verification',
  ]) {
    assert.ok(assessment.includes(field), field);
  }
  assert.doesNotMatch([...files.values()].join('\n'), /\.ai\//, 'names the retired .ai/ folder');
});
