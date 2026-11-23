import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The skills `npx skills add TDrake44/drakom-ai-dev-kit` should offer. */
const OFFERED_SKILLS = ['drakom-ai-setup', 'drakom-plan-audit'];

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

test('the payload manifest and skills/ list the same skill files', async () => {
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'payload', 'v1', 'payload.json'), 'utf8'));
  const manifestSkillFiles = Object.values(manifest.files)
    .filter((source) => source.startsWith('skills/'))
    .sort();
  const shippedSkillFiles = trackedFiles()
    .filter((file) => file.startsWith('skills/'))
    .sort();

  assert.deepEqual(manifestSkillFiles, shippedSkillFiles);
  assert.equal(
    trackedFiles().some((file) => file.startsWith('payload/v1/skills/')),
    false,
    'kit skills must live in skills/, not payload/v1/skills/',
  );
});

test('kit skills name their references inside their own folder, not by a repo-root path', async () => {
  for (const file of trackedFiles().filter((tracked) => tracked.startsWith('skills/'))) {
    const content = await readFile(path.join(repositoryRoot, file), 'utf8');
    assert.doesNotMatch(content, /\.agents\/skills\/drakom-[^/`]+\/references\//, `${file} names a repo-root reference path`);
  }
});

test('this repository hides its own workflow skills from npx skills add', async () => {
  for (const name of ['dev', 'document', 'plan', 'pr-review']) {
    for (const folder of ['.agents/skills', '.claude/skills']) {
      assert.equal(isInternal(await readFrontmatter(`${folder}/${name}/SKILL.md`)), true, `${folder}/${name} is not internal`);
    }
  }
});
