import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repositoryRoot, 'scripts', 'sync-skill-mirrors.mjs');
const generatedNotice =
  '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->\n\n';

async function createFixture() {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'drakom-skills-'));
  await mkdir(path.join(fixtureRoot, '.agents', 'skills', 'review'), { recursive: true });
  await writeFile(
    path.join(fixtureRoot, '.agents', 'skills', 'review', 'SKILL.md'),
    '---\nname: review\ndescription: Review changes.\n---\n\n# Review\n',
    'utf8',
  );
  return fixtureRoot;
}

/**
 * @param {string} cwd
 * @param {...string} args
 */
function runSync(cwd, ...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('creates mirrors with YAML frontmatter first and detects subsequent drift', async () => {
  const fixtureRoot = await createFixture();
  assert.equal(runSync(fixtureRoot).status, 0);

  const mirrorPath = path.join(fixtureRoot, '.claude', 'skills', 'review', 'SKILL.md');
  const mirror = await readFile(mirrorPath, 'utf8');
  assert.match(mirror, /^---\nname: review\ndescription: Review changes\.\n---\n/);
  assert.match(mirror, /---\n\n<!-- GENERATED MIRROR/);
  assert.match(mirror, /Run "drakom-ai sync \."/);
  await writeFile(mirrorPath, mirror.replace('# Review', '# Changed review'), 'utf8');

  const result = runSync(fixtureRoot, '--check');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Skill mirror out of sync/);
});

test('refuses a hand-authored same-name skill before making any mutations', async () => {
  const fixtureRoot = await createFixture();
  const secondSource = path.join(fixtureRoot, '.agents', 'skills', 'second', 'SKILL.md');
  await mkdir(path.dirname(secondSource), { recursive: true });
  await writeFile(secondSource, '---\nname: second\n---\n\n# Second\n', 'utf8');

  const collisionPath = path.join(fixtureRoot, '.claude', 'skills', 'review', 'SKILL.md');
  await mkdir(path.dirname(collisionPath), { recursive: true });
  await writeFile(collisionPath, '---\nname: review\n---\n\n# My custom review\n', 'utf8');
  const stalePath = path.join(fixtureRoot, '.claude', 'skills', 'stale', 'SKILL.md');
  await mkdir(path.dirname(stalePath), { recursive: true });
  await writeFile(stalePath, `${generatedNotice}# Stale\n`, 'utf8');

  const result = runSync(fixtureRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /hand-authored Claude skill/);
  assert.equal(await readFile(collisionPath, 'utf8'), '---\nname: review\n---\n\n# My custom review\n');
  await assert.rejects(access(path.join(fixtureRoot, '.claude', 'skills', 'second', 'SKILL.md')));
  await access(stalePath);
});

test('refuses an existing Claude skill directory without a SKILL.md', async () => {
  const fixtureRoot = await createFixture();
  const targetDirectory = path.join(fixtureRoot, '.claude', 'skills', 'review');
  await mkdir(targetDirectory, { recursive: true });
  await writeFile(path.join(targetDirectory, 'reference.md'), '# Custom reference\n', 'utf8');

  const result = runSync(fixtureRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /hand-authored Claude skill/);
  assert.equal(await readFile(path.join(targetDirectory, 'reference.md'), 'utf8'), '# Custom reference\n');
  await assert.rejects(access(path.join(targetDirectory, 'SKILL.md')));
});

test('does not treat a generated-notice quote in a custom skill body as ownership', async () => {
  const fixtureRoot = await createFixture();
  const collisionPath = path.join(fixtureRoot, '.claude', 'skills', 'review', 'SKILL.md');
  await mkdir(path.dirname(collisionPath), { recursive: true });
  await writeFile(
    collisionPath,
    `---\nname: review\n---\n\n# Custom review\n\n${generatedNotice}`,
    'utf8',
  );

  const result = runSync(fixtureRoot);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /hand-authored Claude skill/);
});

test('removes stale generated mirrors but preserves Claude-only skills', async () => {
  const fixtureRoot = await createFixture();
  const staleDirectory = path.join(fixtureRoot, '.claude', 'skills', 'stale');
  const customDirectory = path.join(fixtureRoot, '.claude', 'skills', 'custom');
  await mkdir(staleDirectory, { recursive: true });
  await mkdir(customDirectory, { recursive: true });
  await writeFile(path.join(staleDirectory, 'SKILL.md'), `${generatedNotice}# Stale\n`, 'utf8');
  await writeFile(path.join(customDirectory, 'SKILL.md'), '# Custom\n', 'utf8');

  const result = runSync(fixtureRoot);
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(access(staleDirectory));
  await access(customDirectory);
});

test('preserves custom supporting files when removing a stale generated mirror', async () => {
  const fixtureRoot = await createFixture();
  const staleDirectory = path.join(fixtureRoot, '.claude', 'skills', 'stale');
  await mkdir(staleDirectory, { recursive: true });
  await writeFile(path.join(staleDirectory, 'SKILL.md'), `${generatedNotice}# Stale\n`, 'utf8');
  await writeFile(path.join(staleDirectory, 'reference.md'), '# Custom reference\n', 'utf8');

  const result = runSync(fixtureRoot);
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(access(path.join(staleDirectory, 'SKILL.md')));
  assert.equal(await readFile(path.join(staleDirectory, 'reference.md'), 'utf8'), '# Custom reference\n');
});
