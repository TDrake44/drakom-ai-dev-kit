import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');
const setupSkill = '.agents/skills/drakom-ai-setup/SKILL.md';

/**
 * @param {string[]} args
 * @param {string} [cwd]
 */
function drakom(args, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', cwd });
}

/**
 * A scratch directory holding `repo/`, removed after the test.
 * @param {import('node:test').TestContext} t
 */
async function scratch(t) {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'drakom-link-target-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  await mkdir(repo);
  return { base, repo };
}

/**
 * The link type for a directory: a junction on Windows, which needs no privilege and which Node
 * reports as a symlink.
 */
const dirLink = process.platform === 'win32' ? 'junction' : 'dir';

/**
 * Create a symlink, or skip the test where the platform does not permit one.
 * @param {import('node:test').TestContext} t
 * @param {string} target
 * @param {string} linkPath
 * @param {'dir' | 'file'} type
 * @returns {Promise<boolean>} false when the test was skipped
 */
async function trySymlink(t, target, linkPath, type) {
  try {
    await symlink(target, linkPath, type === 'dir' ? dirLink : type);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip(`creating a symlink is not permitted here (${error.code})`);
      return false;
    }
    throw error;
  }
}

test('init and sync work through a target path that is a symlink to the repository', async (t) => {
  const { base, repo } = await scratch(t);
  const link = path.join(base, 'link');
  if (!(await trySymlink(t, repo, link, 'dir'))) return;

  const init = drakom(['init', link, '--yes']);
  const sync = drakom(['sync', link]);
  const check = drakom(['sync', link, '--check']);

  assert.equal(init.status, 0, init.stdout + init.stderr);
  assert.ok(init.stdout.includes(`Target: ${repo} (resolved from ${link})\n`), init.stdout);
  assert.match(await readFile(path.join(repo, '.drakom-ai', 'state.json'), 'utf8'), /"schemaVersion": 1/);
  assert.equal(sync.status, 0, sync.stdout + sync.stderr);
  assert.ok(sync.stdout.includes(`Target: ${repo} (resolved from ${link})\n`), sync.stdout);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test('a target typed without a symlink prints the path as typed', async (t) => {
  const { repo } = await scratch(t);

  const init = drakom(['init', repo, '--yes']);

  assert.equal(init.status, 0, init.stdout + init.stderr);
  assert.ok(init.stdout.includes(`Target: ${repo}\n`), init.stdout);
});

test('--accept and --release take paths through a symlinked target, relative or absolute', async (t) => {
  const { base, repo } = await scratch(t);
  const link = path.join(base, 'link');
  if (!(await trySymlink(t, repo, link, 'dir'))) return;
  assert.equal(drakom(['init', link, '--yes']).status, 0);
  await writeFile(path.join(repo, ...setupSkill.split('/')), '---\nname: drakom-ai-setup\ndescription: Mine\n---\n', 'utf8');
  const rulesAnatomy = '.agents/skills/drakom-ai-setup/references/rule-anatomy.md';
  await writeFile(path.join(repo, ...rulesAnatomy.split('/')), '# Mine\n', 'utf8');

  const sync = drakom(['sync', link, '--accept', path.join(link, ...setupSkill.split('/')), '--release', rulesAnatomy]);

  assert.equal(sync.status, 0, sync.stdout + sync.stderr);
  const state = JSON.parse(await readFile(path.join(repo, '.drakom-ai', 'state.json'), 'utf8'));
  assert.equal(typeof state.managedFiles[setupSkill].acceptedFingerprint, 'string');
  assert.deepEqual(state.releasedFiles, [rulesAnatomy]);
});

test('the kit still refuses to write through a symlink inside a symlinked target', async (t) => {
  const { base, repo } = await scratch(t);
  const link = path.join(base, 'link');
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  if (!(await trySymlink(t, repo, link, 'dir'))) return;
  await symlink(outside, path.join(repo, '.claude'), dirLink);

  const init = drakom(['init', link, '--yes']);

  assert.notEqual(init.status, 0);
  assert.match(init.stdout, /CONFLICT\s+\.claude\b.*outside the repository/);
});

test('a target symlink to a file or to nothing is reported as a link with its destination', async (t) => {
  const { base } = await scratch(t);
  const file = path.join(base, 'file.txt');
  await writeFile(file, 'not a directory\n', 'utf8');
  const fileLink = path.join(base, 'file-link');
  const danglingLink = path.join(base, 'dangling-link');
  const missing = path.join(base, 'missing');
  if (!(await trySymlink(t, file, fileLink, 'file'))) return;
  await symlink(missing, danglingLink, dirLink);

  const toFile = drakom(['init', fileLink, '--yes']);
  const toNothing = drakom(['sync', danglingLink]);

  assert.equal(toFile.status, 1);
  assert.equal(
    toFile.stderr.trim(),
    `drakom-ai: Target path ${fileLink} is a symlink to ${file}, which is not a directory.`,
  );
  assert.equal(toNothing.status, 1);
  assert.equal(
    toNothing.stderr.trim(),
    `drakom-ai: Target path ${danglingLink} is a symlink to ${missing}, which does not exist.`,
  );
});

test('a path typed from the current directory through the link gets the "Did you mean" hint', async (t) => {
  const { base, repo } = await scratch(t);
  const link = path.join(base, 'link');
  if (!(await trySymlink(t, repo, link, 'dir'))) return;
  assert.equal(drakom(['init', link, '--yes']).status, 0);

  const sync = drakom(['sync', 'link', '--accept', path.join('link', ...setupSkill.split('/'))], base);

  assert.equal(sync.status, 1);
  assert.match(sync.stderr, new RegExp(`Did you mean ${setupSkill.replaceAll('.', '\\.')}\\? Paths are relative to the target`));
});

test('a target symlink that is part of a loop is reported as a link with its destination', async (t) => {
  const { base } = await scratch(t);
  const first = path.join(base, 'first');
  const second = path.join(base, 'second');
  if (!(await trySymlink(t, second, first, 'dir'))) return;
  await symlink(first, second, dirLink);

  const result = drakom(['sync', first]);

  assert.equal(result.status, 1);
  assert.equal(
    result.stderr.trim(),
    `drakom-ai: Target path ${first} is a symlink to ${second}, which is part of a symlink loop.`,
  );
});
