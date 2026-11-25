import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The skills `npx skills add TDrake44/drakom-ai-dev-kit` should offer. */
const OFFERED_SKILLS = ['drakom-ai-setup', 'drakom-dev', 'drakom-handoff', 'drakom-plan-audit', 'drakom-review'];

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

test('the payload manifest lists every file of the CLI-installed skills, and no other skill', async () => {
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'payload', 'v1', 'payload.json'), 'utf8'));
  const manifestSkillFiles = Object.values(manifest.files)
    .filter((source) => source.startsWith('skills/'))
    .sort();
  const payloadSkillFiles = trackedFiles()
    .filter((file) => PAYLOAD_SKILLS.some((name) => file.startsWith(`skills/${name}/`)))
    .sort();

  assert.deepEqual(manifestSkillFiles, payloadSkillFiles);
  assert.equal(
    trackedFiles().some((file) => file.startsWith('payload/v1/skills/')),
    false,
    'kit skills must live in skills/, not payload/v1/skills/',
  );
});

test('the setup skill says where its references are for both kinds of install, and each one exists', async () => {
  const skill = await readFile(path.join(repositoryRoot, 'skills/drakom-ai-setup/SKILL.md'), 'utf8');

  // An `npx skills` install keeps references/ beside SKILL.md; the CLI's Claude mirror holds only
  // SKILL.md, so a CLI-set-up project needs the repo-root path.
  assert.match(skill, /`references\/` folder beside this SKILL\.md when the skill was installed with `npx skills`/);
  assert.match(skill, /set up with the kit CLI they are at the repository-root path `\.agents\/skills\/drakom-ai-setup\/references\/`/);
  const named = [...skill.matchAll(/`references\/([^`<]+)`/g)].map(([, file]) => file);
  assert.ok(named.length > 0);
  const tracked = trackedFiles();
  for (const file of named) {
    assert.ok(tracked.includes(`skills/drakom-ai-setup/references/${file}`), `${file} is not shipped`);
  }
});

test('this repository hides its own workflow skill from npx skills add, and its retired ones are gone', async () => {
  for (const folder of ['.agents/skills', '.claude/skills']) {
    assert.equal(isInternal(await readFrontmatter(`${folder}/plan/SKILL.md`)), true, `${folder}/plan is not internal`);
    for (const retired of ['dev', 'document']) {
      assert.equal(
        trackedFiles().some((file) => file.startsWith(`${folder}/${retired}/`)),
        false,
        `${folder}/${retired} retired with drakom-dev`,
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
    '.github/pull_request_template.md',
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
  assert.deepEqual(labels, ['credentials', 'user data', 'agent instructions', 'weakens a check']);
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

test('the PR template keeps the Risk line to the level and the label names', async () => {
  const template = (await readFile(path.join(repositoryRoot, '.github/pull_request_template.md'), 'utf8')).replace(/\s+/g, ' ');

  assert.match(template, /The Risk line is a quick eye catch: the level and the label names, nothing more\./);
  assert.match(template, /Paths and reasons go in Reviewer focus\./);
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

test('a kit skill offers another kit skill only when that one is installed', async () => {
  for (const file of trackedFiles().filter((tracked) => /^skills\/[^/]+\/.+\.md$/.test(tracked))) {
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
  const beforeCheck = reference.match(/Until the blind risk check is done, ([^.]*)\./);
  assert.ok(beforeCheck, 'no "Until the blind risk check is done" sentence');
  assert.doesNotMatch(beforeCheck[1], /re-review|marker/, 'the check needs no earlier review, so nothing about one is read before it');
});
