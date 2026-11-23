import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The skills `npx skills add TDrake44/drakom-ai-dev-kit` should offer. */
const OFFERED_SKILLS = ['drakom-ai-setup', 'drakom-plan-audit', 'drakom-review'];

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

test('this repository hides its own workflow skills from npx skills add', async () => {
  for (const name of ['dev', 'document', 'plan']) {
    for (const folder of ['.agents/skills', '.claude/skills']) {
      assert.equal(isInternal(await readFrontmatter(`${folder}/${name}/SKILL.md`)), true, `${folder}/${name} is not internal`);
    }
  }
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

test('the review skill names each of its references, and each one exists in its own folder', async () => {
  const files = await reviewSkillFiles();
  const text = [...files.values()].join('\n');

  const named = new Set([...text.matchAll(/`references\/([^`<]+)`/g)].map(([, file]) => `references/${file}`));
  const shipped = [...files.keys()].filter((file) => file.startsWith('references/'));
  assert.ok(shipped.length > 0);
  assert.deepEqual([...named].sort(), shipped.sort());
  const skill = files.get('SKILL.md') ?? '';
  for (const reference of shipped) {
    assert.ok(skill.includes(`\`${reference}\``), `SKILL.md does not name ${reference}`);
  }
});

test('the review skill stands alone: it names no file in another skill or a repo file it has no default for', async () => {
  const text = [...(await reviewSkillFiles()).values()].join('\n');

  assert.doesNotMatch(text, /skills\/(?!drakom-review\b)[\w-]+\//, 'names a file in another skill folder');
  assert.doesNotMatch(text, /\.(agents|claude)\/skills\//, 'names an installed skill folder');
  // Repo files the skill reads, each with a default when it is missing (see "When the repo has nothing"),
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

  const section = skill.match(/## When the repo has nothing\n([\s\S]*?)(?=\n## |$)/);
  assert.ok(section, 'no "When the repo has nothing" section');
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
  const riskCheck = (await reviewSkillFiles()).get('references/risk-check.md') ?? '';

  const section = riskCheck.match(/## Default labels\n([\s\S]*?)(?=\n## |$)/);
  assert.ok(section, 'no "Default labels" section');
  const labels = [...section[1].matchAll(/^- \*\*([^*]+)\*\*/gm)].map(([, label]) => label);
  assert.deepEqual(labels, ['credentials', 'user data', 'agent instructions', 'weakens a check']);
});
