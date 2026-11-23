import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fsPromises, { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { applyPlan } from '../dist/apply-plan.js';
import { DRAKOM_DIR } from '../dist/constants.js';
import { payloadFileLocation } from '../dist/package-payload.js';
import { runCli } from '../dist/run-cli.js';

/**
 * @typedef {import('../dist/operation-plan.js').Operation} Operation
 * @typedef {import('../dist/operation-plan.js').OperationPlan} OperationPlan
 */

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');
const statePath = `${DRAKOM_DIR}/state.json`;
const setupSkill = '.agents/skills/drakom-ai-setup/SKILL.md';
const setupSkillSource = 'skills/drakom-ai-setup/SKILL.md';
const ruleAnatomy = '.agents/skills/drakom-ai-setup/references/rule-anatomy.md';
const ruleAnatomySource = 'skills/drakom-ai-setup/references/rule-anatomy.md';
const planAudit = '.agents/skills/drakom-plan-audit/SKILL.md';
const planAuditSource = 'skills/drakom-plan-audit/SKILL.md';

/**
 * @param {string} cli
 * @param {string[]} args
 */
function run(cli, args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

/** @param {string} content */
function fingerprint(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * An empty directory, removed after the test.
 * @param {import('node:test').TestContext} t
 * @param {string} [prefix]
 */
async function scratch(t, prefix = 'drakom-recovery-') {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * A target initialized by the CLI under test, removed after the test.
 * @param {import('node:test').TestContext} t
 */
async function createInstalled(t) {
  const root = await scratch(t);
  const init = run(cliPath, ['init', root, '--yes']);
  assert.equal(init.status, 0, init.stdout + init.stderr);
  return root;
}

/**
 * @param {string} root
 * @param {string} relativePath
 */
function resolve(root, relativePath) {
  return path.join(root, ...relativePath.split('/'));
}

/**
 * @param {string} root
 * @param {string} relativePath
 */
function read(root, relativePath) {
  return readFile(resolve(root, relativePath), 'utf8');
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @param {string} content
 */
async function write(root, relativePath, content) {
  await mkdir(path.dirname(resolve(root, relativePath)), { recursive: true });
  await writeFile(resolve(root, relativePath), content, 'utf8');
}

/** @param {string} root */
async function readState(root) {
  return JSON.parse(await read(root, statePath));
}

/**
 * Record a managed file as installed from an older kit, so the next sync wants to update it.
 * @param {string} root
 * @param {string} managedPath
 */
async function makeOutdated(root, managedPath) {
  const oldContent = '# Older kit content\n';
  await write(root, managedPath, oldContent);
  const state = await readState(root);
  state.managedFiles[managedPath].fingerprint = fingerprint(oldContent);
  await write(root, statePath, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Every path under `root` with its exact content. A file that is not valid UTF-8 is recorded as
 * hex, so two snapshots are equal only when the bytes are.
 * @param {string} root
 */
async function snapshot(root) {
  /** @type {Record<string, string>} */
  const result = {};

  /** @param {string} directory */
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : 1));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
      if (entry.isDirectory()) {
        result[`${relativePath}/`] = 'directory';
        await visit(absolutePath);
      } else {
        const bytes = await readFile(absolutePath);
        const text = bytes.toString('utf8');
        result[relativePath] = Buffer.from(text, 'utf8').equals(bytes) ? text : `hex:${bytes.toString('hex')}`;
      }
    }
  }

  await visit(root);
  return result;
}

/**
 * The modification time of every file and directory under `root`. A file rewritten with the same
 * bytes, or a temporary file created and removed again, changes one of these.
 * @param {string} root
 */
async function modificationTimes(root) {
  /** @type {Record<string, number>} */
  const result = {};
  for (const relativePath of ['', ...Object.keys(await snapshot(root))]) {
    result[relativePath] = (await lstat(path.join(root, relativePath))).mtimeMs;
  }
  return result;
}

/**
 * The temporary file `applyPlan` writes before it renames it over `relativePath`, for the plan's
 * update or merge number `index`, counted from 0. Creating this file first makes that write fail
 * with EEXIST on every platform; a read-only directory would not stop the write on Windows.
 * @param {string} root
 * @param {string} relativePath
 * @param {number} index
 * @param {number} [pid]
 */
function temporaryPathFor(root, relativePath, index, pid = process.pid) {
  const absolutePath = resolve(root, relativePath);
  return path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${DRAKOM_DIR.replace(/^\./, '')}-${pid}-${index}.tmp`,
  );
}

/**
 * @param {Operation['action']} action
 * @param {string} targetPath
 * @param {{ before?: string, content?: string }} [contents]
 * @returns {Operation}
 */
function operation(action, targetPath, contents = {}) {
  return { action, path: targetPath, summary: 'Hand-built for the test.', ...contents };
}

/**
 * @param {string} root
 * @param {Operation[]} operations
 * @returns {OperationPlan}
 */
function syncPlan(root, operations) {
  return { command: 'sync', root, targetStatus: 'existing', operations, hasConflicts: false };
}

/**
 * Copy the compiled kit into a standalone directory so a test can alter its payload.
 * @param {import('node:test').TestContext} t
 * @param {(writePayloadFile: (source: string, content: string) => Promise<void>, kitRoot: string) => Promise<void>} mutate
 *   `writePayloadFile` takes a manifest path and writes it where the kit reads it.
 * @returns {Promise<string>} path to the copied cli.js
 */
async function createKitCopy(t, mutate) {
  const kitRoot = await scratch(t, 'drakom-recovery-kit-');
  await cp(path.join(repositoryRoot, 'dist'), path.join(kitRoot, 'dist'), { recursive: true });
  await cp(path.join(repositoryRoot, 'payload'), path.join(kitRoot, 'payload'), { recursive: true });
  await cp(path.join(repositoryRoot, 'skills'), path.join(kitRoot, 'skills'), { recursive: true });
  await cp(path.join(repositoryRoot, 'package.json'), path.join(kitRoot, 'package.json'));
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(kitRoot, 'node_modules'), 'junction');
  await mutate((source, content) => write(kitRoot, payloadFileLocation(source), content), kitRoot);
  return path.join(kitRoot, 'dist', 'cli.js');
}

/**
 * Replace `node:fs/promises` functions for the code under test until the returned function is
 * called. `applyPlan` imports them by name, and `syncBuiltinESMExports` is what makes a named
 * import see the replacement. Only for a failure that has to happen partway through a run, which
 * files on disk cannot time.
 * @param {Partial<typeof fsPromises>} replacements
 * @returns {() => void} puts the real functions back
 */
function replaceFsPromises(replacements) {
  const originals = { ...fsPromises };
  Object.assign(fsPromises, replacements);
  syncBuiltinESMExports();
  return () => {
    Object.assign(fsPromises, originals);
    syncBuiltinESMExports();
  };
}

// A write fails midway.

test('a write that fails midway restores every earlier change and reports the original error', async (t) => {
  const root = await scratch(t);
  const files = {
    'docs/updated.md': 'before the update\r\nsecond line\r\n',
    'config/merged.json': '{"name": "café"}',
    'retired/only-file.md': 'before the delete\n',
    'late.md': 'before the write that fails\n',
    'untouched.md': 'never in the plan\n',
    [statePath]: '{"schemaVersion": 1}\n',
  };
  for (const [relativePath, content] of Object.entries(files)) {
    await write(root, relativePath, content);
  }
  // late.md is the plan's third update or merge, so this file is where its temporary copy goes.
  const blocker = temporaryPathFor(root, 'late.md', 2);
  await writeFile(blocker, 'in the way\n', 'utf8');
  const plan = syncPlan(root, [
    operation('mkdir', 'added/nested'),
    operation('create', 'added/nested/created.md', { content: 'created\n' }),
    operation('create', 'implied/parent/created.md', { content: 'created\n' }),
    operation('update', 'docs/updated.md', { before: files['docs/updated.md'], content: 'after the update\n' }),
    operation('merge', 'config/merged.json', { before: files['config/merged.json'], content: '{"name": "merged"}\n' }),
    operation('delete', 'retired/only-file.md', { before: files['retired/only-file.md'] }),
    operation('update', 'late.md', { before: files['late.md'], content: 'never written\n' }),
    operation('update', statePath, { before: files[statePath], content: '{"schemaVersion": 2}\n' }),
  ]);
  const before = await snapshot(root);

  const applied = applyPlan(plan);

  await assert.rejects(applied, (error) => {
    assert.ok(error instanceof Error);
    assert.equal('code' in error && error.code, 'EEXIST', error.message);
    assert.equal('path' in error && error.path, blocker, error.message);
    return true;
  });
  assert.deepEqual(await snapshot(root), before);
});

// A restore fails during rollback.

test('a restore that fails during rollback does not stop the remaining restores', async (t) => {
  const root = await scratch(t);
  const files = {
    'first.md': 'first, before\n',
    'second.md': 'second, before\n',
    'unrestorable.md': 'unrestorable, before\n',
    'merged.json': '{"merged": "before"}\n',
    'retired/deleted.md': 'deleted, before\n',
    'late.md': 'late, before\n',
  };
  for (const [relativePath, content] of Object.entries(files)) {
    await write(root, relativePath, content);
  }
  // late.md is the plan's fifth update or merge; blocking its temporary copy starts the rollback.
  await writeFile(temporaryPathFor(root, 'late.md', 4), 'in the way\n', 'utf8');
  const plan = syncPlan(root, [
    operation('create', 'created.md', { content: 'created\n' }),
    operation('update', 'first.md', { before: files['first.md'], content: 'first, after\n' }),
    operation('update', 'second.md', { before: files['second.md'], content: 'second, after\n' }),
    operation('update', 'unrestorable.md', { before: files['unrestorable.md'], content: 'unrestorable, after\n' }),
    operation('merge', 'merged.json', { before: files['merged.json'], content: '{"merged": "after"}\n' }),
    operation('delete', 'retired/deleted.md', { before: files['retired/deleted.md'] }),
    operation('update', 'late.md', { before: files['late.md'], content: 'never written\n' }),
  ]);
  /** @param {Record<string, string>} tree */
  const exceptUnrestorable = (tree) =>
    Object.fromEntries(Object.entries(tree).filter(([relativePath]) => relativePath !== 'unrestorable.md'));
  const before = exceptUnrestorable(await snapshot(root));
  // New content reaches a file through a temporary copy, so a direct write to this path is its
  // restore. Rollback restores the newest update first, which makes this the first restore tried.
  const unrestorable = resolve(root, 'unrestorable.md');
  const realWriteFile = fsPromises.writeFile;
  const restoreFs = replaceFsPromises({
    writeFile: async (file, data, options) => {
      if (file === unrestorable) {
        throw Object.assign(new Error(`EIO: i/o error, write '${unrestorable}'`), { code: 'EIO' });
      }
      return realWriteFile(file, data, options);
    },
  });

  const [outcome] = await Promise.allSettled([applyPlan(plan)]);
  restoreFs();

  assert(outcome.status === 'rejected');
  assert.deepEqual(exceptUnrestorable(await snapshot(root)), before);
  assert.match(outcome.reason.message, /^EEXIST: .*late\.md.*\nThe rollback could not undo the change to: unrestorable\.md\. Review it before running sync again\.$/);
});

test('a rename that fails is rolled back without leaving its temporary file', async (t) => {
  const root = await scratch(t);
  await write(root, 'first.md', 'first, before\n');
  await write(root, 'held-open.md', 'held open, before\n');
  const plan = syncPlan(root, [
    operation('update', 'first.md', { before: 'first, before\n', content: 'first, after\n' }),
    operation('update', 'held-open.md', { before: 'held open, before\n', content: 'held open, after\n' }),
  ]);
  const before = await snapshot(root);
  // Windows refuses to rename over a file another program holds open; no file on disk can stage
  // that on every platform.
  const heldOpen = resolve(root, 'held-open.md');
  const realRename = fsPromises.rename;
  const restoreFs = replaceFsPromises({
    rename: async (from, to) => {
      if (to === heldOpen) {
        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: 'EPERM' });
      }
      return realRename(from, to);
    },
  });

  const [outcome] = await Promise.allSettled([applyPlan(plan)]);
  restoreFs();

  assert(outcome.status === 'rejected');
  assert.equal(outcome.reason.code, 'EPERM');
  assert.deepEqual(await snapshot(root), before);
});

// A file changes between inspection and apply: first before the apply step starts, then while
// it runs.

for (const action of /** @type {const} */ (['update', 'merge', 'delete'])) {
  test(`a file edited after it was inspected is not overwritten by a planned ${action}`, async (t) => {
    const root = await scratch(t);
    await write(root, 'first.md', 'first, as inspected\n');
    await write(root, 'edited.md', 'edited, as inspected\n');
    await write(root, statePath, '{"schemaVersion": 1}\n');
    const plan = syncPlan(root, [
      operation('create', 'created.md', { content: 'created\n' }),
      operation('update', 'first.md', { before: 'first, as inspected\n', content: 'first, from the kit\n' }),
      operation(action, 'edited.md', {
        before: 'edited, as inspected\n',
        ...(action === 'delete' ? {} : { content: 'edited, from the kit\n' }),
      }),
      operation('update', statePath, { before: '{"schemaVersion": 1}\n', content: '{"schemaVersion": 2}\n' }),
    ]);
    await write(root, 'edited.md', 'saved by the user after the inspection\n');
    const before = await snapshot(root);

    const applied = applyPlan(plan);

    await assert.rejects(applied, /Preflight failed: edited\.md changed after inspection; rerun sync\./);
    assert.deepEqual(await snapshot(root), before);
  });
}

for (const action of /** @type {const} */ (['update', 'merge', 'delete'])) {
  test(`a file saved while the apply step runs is not overwritten by a planned ${action}`, async (t) => {
    const root = await scratch(t);
    await write(root, 'first.md', 'first, as inspected\n');
    await write(root, 'raced.md', 'raced, as inspected\n');
    const plan = syncPlan(root, [
      operation('update', 'first.md', { before: 'first, as inspected\n', content: 'first, from the kit\n' }),
      operation(action, 'raced.md', {
        before: 'raced, as inspected\n',
        ...(action === 'delete' ? {} : { content: 'raced, from the kit\n' }),
      }),
    ]);
    const saved = 'saved by the user while the apply step ran\n';
    // The rename that puts first.md in place runs after every check of the plan has passed and
    // before raced.md is touched, so the save lands where an editor or another agent could land one.
    const first = resolve(root, 'first.md');
    const raced = resolve(root, 'raced.md');
    const realRename = fsPromises.rename;
    const realWriteFile = fsPromises.writeFile;
    const restoreFs = replaceFsPromises({
      rename: async (from, to) => {
        if (to === first) {
          await realWriteFile(raced, saved, 'utf8');
        }
        return realRename(from, to);
      },
    });

    const [outcome] = await Promise.allSettled([applyPlan(plan)]);
    restoreFs();

    assert.equal((await snapshot(root))['raced.md'], saved);
    assert.equal(outcome.status, 'rejected', 'a run that met the save must not report success');
  });
}

// A run is killed partway, then retried. Each test builds the files a killed run leaves behind.

test('a sync killed between two updates is finished by the next sync, which never adopts the leftover temporary file', async (t) => {
  const root = await createInstalled(t);
  const newer = {
    [setupSkill]: '---\nname: drakom-ai-setup\ndescription: Newer kit\n---\n\n# Newer setup skill\n',
    [ruleAnatomy]: '# Newer rule anatomy\n',
    [planAudit]: '---\nname: drakom-plan-audit\ndescription: Newer kit\n---\n\n# Newer plan audit\n',
  };
  const newerKit = await createKitCopy(t, async (writePayloadFile) => {
    await writePayloadFile(setupSkillSource, newer[setupSkill]);
    await writePayloadFile(ruleAnatomySource, newer[ruleAnatomy]);
    await writePayloadFile(planAuditSource, newer[planAudit]);
  });
  // The killed run renamed the first update into place and was writing the temporary copy of the
  // second. The third file, both skill mirrors and state.json were never reached.
  await write(root, setupSkill, newer[setupSkill]);
  const leftover = path
    .relative(root, temporaryPathFor(root, ruleAnatomy, 1, 4242))
    .split(path.sep)
    .join('/');
  await write(root, leftover, newer[ruleAnatomy].slice(0, 8));

  const retry = run(newerKit, ['sync', root]);

  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  for (const [managedPath, content] of Object.entries(newer)) {
    assert.equal(await read(root, managedPath), content, managedPath);
  }
  const state = await readState(root);
  for (const [managedPath, content] of Object.entries(newer)) {
    assert.equal(state.managedFiles[managedPath].fingerprint, fingerprint(content), managedPath);
  }
  const check = run(newerKit, ['sync', root, '--check']);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  // The leftover is not recorded, mirrored, reported or joined by another temporary file.
  assert.doesNotMatch(JSON.stringify(state), /\.tmp/);
  assert.doesNotMatch(retry.stdout + check.stdout, /\.tmp/);
  const temporaryFiles = Object.keys(await snapshot(root)).filter((relativePath) => relativePath.endsWith('.tmp'));
  assert.deepEqual(temporaryFiles.filter((relativePath) => relativePath !== leftover), []);
});

test('a file half-written by a killed sync is reported as a conflict, never recorded as managed, and installs once removed', async (t) => {
  const exampleSkill = '.agents/skills/drakom-example-default/SKILL.md';
  const exampleReference = '.agents/skills/drakom-example-default/references/example.md';
  const exampleReferenceContent = '# Example reference\n';
  const root = await createInstalled(t);
  const state = await readState(root);
  await write(root, statePath, `${JSON.stringify({ ...state, kitVersion: '0.0.9' }, null, 2)}\n`);
  const newerKit = await createKitCopy(t, async (writePayloadFile, kitRoot) => {
    await writePayloadFile(
      'skills/drakom-example-default/SKILL.md',
      '---\nname: drakom-example-default\ndescription: Synthetic default skill\n---\n\n# Example\n',
    );
    await writePayloadFile('skills/drakom-example-default/references/example.md', exampleReferenceContent);
    const manifest = JSON.parse(await read(kitRoot, 'payload/v1/payload.json'));
    manifest.files.exampleSkill = 'skills/drakom-example-default/SKILL.md';
    manifest.files.exampleReference = 'skills/drakom-example-default/references/example.md';
    manifest.defaults = {
      ...manifest.defaults,
      exampleSkill: { target: exampleSkill, addedIn: manifest.kitVersion },
      exampleReference: { target: exampleReference, addedIn: manifest.kitVersion },
    };
    await write(kitRoot, 'payload/v1/payload.json', `${JSON.stringify(manifest, null, 2)}\n`);
  });
  // A new file is written in place, so a kill leaves the start of it. state.json was never reached.
  const halfWritten = exampleReferenceContent.slice(0, 6);
  await write(root, exampleReference, halfWritten);

  const retry = run(newerKit, ['sync', root]);

  assert.equal(retry.status, 2, retry.stdout + retry.stderr);
  assert.match(
    retry.stdout,
    /CONFLICT \.agents\/skills\/drakom-example-default\/references\/example\.md — Unmanaged path occupies a default file .*Move or remove it, then run `drakom-ai sync` again/,
  );
  assert.equal(await read(root, exampleReference), halfWritten);
  const retried = await readState(root);
  assert.equal(Object.hasOwn(retried.managedFiles, exampleReference), false);
  assert.equal(retried.kitVersion, '0.0.9');

  // The conflict row's own advice is the way out.
  await rm(resolve(root, exampleReference));
  const afterRemoval = run(newerKit, ['sync', root]);
  assert.equal(afterRemoval.status, 0, afterRemoval.stdout + afterRemoval.stderr);
  assert.equal(await read(root, exampleReference), exampleReferenceContent);
  assert.equal(run(newerKit, ['sync', root, '--check']).status, 0);
});

test('an init killed before it recorded its state is refused by sync and by a second init, and neither changes a file', async (t) => {
  const root = await createInstalled(t);
  // state.json is the last write of an init and the skill mirrors come just before it.
  await rm(resolve(root, statePath));
  await rm(resolve(root, '.claude'), { recursive: true });
  const before = await snapshot(root);

  const sync = run(cliPath, ['sync', root]);
  const init = run(cliPath, ['init', root, '--yes']);

  assert.equal(sync.status, 1, sync.stdout + sync.stderr);
  assert.match(sync.stderr, /Directory \.drakom-ai exists without managed state; review ownership before synchronizing\./);
  assert.equal(init.status, 2, init.stdout + init.stderr);
  assert.match(init.stdout, /CONFLICT \.drakom-ai — Directory exists without managed state; review ownership before initialization\./);
  assert.match(init.stdout, /CONFLICT \.agents\/skills\/drakom-ai-setup\/SKILL\.md — Unmanaged path already exists\./);
  assert.match(init.stdout, /Result: review conflicts; no changes made\./);
  assert.deepEqual(await snapshot(root), before);
});

test('a state file cut short by a killed init is refused by sync and by a second init, and neither changes a file', async (t) => {
  const root = await createInstalled(t);
  // An init creates state.json in place, so a kill during that write leaves the start of it.
  await truncate(resolve(root, statePath), 120);
  const before = await snapshot(root);

  const sync = run(cliPath, ['sync', root]);
  const init = run(cliPath, ['init', root, '--yes']);

  assert.equal(sync.status, 1, sync.stdout + sync.stderr);
  assert.match(sync.stderr, /state\.json must contain valid JSON\./);
  assert.equal(init.status, 1, init.stdout + init.stderr);
  assert.match(init.stderr, /state\.json must contain valid JSON\./);
  assert.deepEqual(await snapshot(root), before);
});

// File permissions survive an update and a merge.

/**
 * @param {string} root
 * @param {string} relativePath
 * @returns {Promise<string>} the permission bits in octal, such as `600`
 */
async function permissions(root, relativePath) {
  return ((await lstat(resolve(root, relativePath))).mode & 0o777).toString(8);
}

for (const action of /** @type {const} */ (['update', 'merge'])) {
  test(
    `a planned ${action} keeps the permissions of the file it rewrites`,
    { skip: process.platform === 'win32' ? 'Windows has no POSIX permission bits' : false },
    async (t) => {
      const root = await scratch(t);
      await write(root, 'private.json', '{"setting": "before"}\n');
      await chmod(resolve(root, 'private.json'), 0o600);
      await write(root, 'tool.sh', '#!/bin/sh\necho before\n');
      await chmod(resolve(root, 'tool.sh'), 0o755);
      const plan = syncPlan(root, [
        operation(action, 'private.json', { before: '{"setting": "before"}\n', content: '{"setting": "after"}\n' }),
        operation(action, 'tool.sh', { before: '#!/bin/sh\necho before\n', content: '#!/bin/sh\necho after\n' }),
      ]);

      await applyPlan(plan);

      assert.equal(await read(root, 'private.json'), '{"setting": "after"}\n');
      assert.equal(await permissions(root, 'private.json'), '600');
      assert.equal(await permissions(root, 'tool.sh'), '755');
    },
  );
}

test(
  'a run that fails and rolls back leaves permissions as they were',
  { skip: process.platform === 'win32' ? 'Windows has no POSIX permission bits' : false },
  async (t) => {
    const root = await scratch(t);
    await write(root, 'private.json', '{"setting": "before"}\n');
    await chmod(resolve(root, 'private.json'), 0o600);
    await write(root, 'retired/tool.sh', '#!/bin/sh\necho before\n');
    await chmod(resolve(root, 'retired/tool.sh'), 0o755);
    await write(root, 'late.md', 'late, before\n');
    // late.md is the plan's second update; blocking its temporary copy starts the rollback.
    await writeFile(temporaryPathFor(root, 'late.md', 1), 'in the way\n', 'utf8');
    const plan = syncPlan(root, [
      operation('update', 'private.json', { before: '{"setting": "before"}\n', content: '{"setting": "after"}\n' }),
      operation('delete', 'retired/tool.sh', { before: '#!/bin/sh\necho before\n' }),
      operation('update', 'late.md', { before: 'late, before\n', content: 'never written\n' }),
    ]);

    const applied = applyPlan(plan);

    await assert.rejects(applied, { code: 'EEXIST' });
    assert.equal(await read(root, 'private.json'), '{"setting": "before"}\n');
    assert.equal(await permissions(root, 'private.json'), '600');
    assert.equal(await permissions(root, 'retired/tool.sh'), '755');
  },
);

// A file that is not UTF-8 cannot be rewritten without changing bytes the plan does not mention.

test('init refuses to merge into a file that is not valid UTF-8 and changes nothing', async (t) => {
  const root = await scratch(t);
  // "Café" in Latin-1: the byte e9 on its own is not valid UTF-8.
  const latin1 = Buffer.concat([Buffer.from('# Caf'), Buffer.from([0xe9]), Buffer.from(' rules\n')]);
  await writeFile(resolve(root, 'AGENTS.md'), latin1);
  const before = await snapshot(root);
  let stderr = '';

  const status = await runCli(['init', root], {
    stdout: { write: () => true },
    stderr: {
      write: (content) => {
        stderr += content;
        return true;
      },
    },
    confirm: async () => true,
  });

  assert.equal(status, 1, stderr);
  assert.match(stderr, /Preflight failed: AGENTS\.md is not valid UTF-8, .*convert it to UTF-8 and rerun init\./);
  assert.deepEqual(await snapshot(root), before);
});

// --dry-run and --check leave every byte alone when they report conflicts.

for (const flag of ['--dry-run', '--check']) {
  test(`sync ${flag} writes nothing when the plan has a conflict and other work it could apply`, async (t) => {
    const root = await createInstalled(t);
    await write(root, setupSkill, '---\nname: drakom-ai-setup\ndescription: Edited locally\n---\n\n# My setup skill\r\n');
    await makeOutdated(root, ruleAnatomy);
    await rm(resolve(root, '.claude/skills/drakom-plan-audit'), { recursive: true });
    const before = await snapshot(root);
    const timesBefore = await modificationTimes(root);

    const result = run(cliPath, ['sync', root, flag]);

    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout, /CONFLICT \.agents\/skills\/drakom-ai-setup\/SKILL\.md — /);
    assert.match(result.stdout, /UPDATE {3}\.agents\/skills\/drakom-ai-setup\/references\/rule-anatomy\.md — /);
    assert.match(result.stdout, /CREATE {3}\.claude\/skills\/drakom-plan-audit\/SKILL\.md — /);
    assert.deepEqual(await snapshot(root), before);
    assert.deepEqual(await modificationTimes(root), timesBefore);
  });
}

test('init --dry-run writes nothing when the plan has a conflict and other work it could apply', async (t) => {
  const root = await scratch(t);
  await write(root, 'AGENTS.md', '# Project agents\r\n\r\nExisting guidance.\r\n');
  await write(root, setupSkill, '# A skill that was here first\n');
  const before = await snapshot(root);
  const timesBefore = await modificationTimes(root);

  const result = run(cliPath, ['init', root, '--dry-run']);

  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /CONFLICT \.agents\/skills\/drakom-ai-setup\/SKILL\.md — Unmanaged path already exists\./);
  assert.match(result.stdout, /CREATE {3}\.drakom-ai\/state\.json — /);
  assert.match(result.stdout, /Result: review conflicts; no changes made\./);
  assert.deepEqual(await snapshot(root), before);
  assert.deepEqual(await modificationTimes(root), timesBefore);
});
