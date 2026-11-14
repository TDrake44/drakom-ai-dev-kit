import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCliArgs } from '../dist/cli-arguments.js';
import { renderCliHelp } from '../dist/cli-help.js';
import { DRAKOM_DIR } from '../dist/constants.js';
import { normalizeTargetRelativePath } from '../dist/managed-file-options.js';
import { createMirrorContent } from '../dist/operation-plan.js';
import { loadPackagePayload } from '../dist/package-payload.js';
import { loadState, serializeState } from '../dist/state.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');
const setupSkill = '.agents/skills/drakom-ai-setup/SKILL.md';
const setupMirror = '.claude/skills/drakom-ai-setup/SKILL.md';
const ruleAnatomy = '.agents/skills/drakom-ai-setup/references/rule-anatomy.md';
const editedSkill = '---\nname: drakom-ai-setup\ndescription: Edited locally\n---\n\n# My setup skill\n';

/** @param {string} content */
function fingerprint(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * @param {string} cli
 * @param {string[]} args
 */
function run(cli, args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

/** @param {string[]} args */
function drakom(args) {
  return run(cliPath, args);
}

/** @returns {Promise<string>} an initialized target */
async function createInstalled() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drakom-conflicts-'));
  const init = drakom(['init', root, '--yes']);
  assert.equal(init.status, 0, init.stderr);
  return root;
}

/**
 * @param {string} root
 * @param {string} relativePath
 */
function read(root, relativePath) {
  return readFile(path.join(root, ...relativePath.split('/')), 'utf8');
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @param {string} content
 */
function write(root, relativePath, content) {
  return writeFile(path.join(root, ...relativePath.split('/')), content, 'utf8');
}

/** @param {string} root */
async function readState(root) {
  return JSON.parse(await read(root, `${DRAKOM_DIR}/state.json`));
}

/**
 * @param {string} root
 * @param {unknown} state
 */
function writeState(root, state) {
  return write(root, `${DRAKOM_DIR}/state.json`, `${JSON.stringify(state, null, 2)}\n`);
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
  await writeState(root, state);
}

/** @param {string} root */
async function snapshot(root) {
  /** @type {Record<string, string>} */
  const result = {};
  /** @param {string} directory */
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else {
        result[path.relative(root, absolutePath).split(path.sep).join('/')] = await readFile(absolutePath, 'utf8');
      }
    }
  }
  await visit(root);
  return result;
}

/**
 * @typedef {{ kitVersion: string, files: Record<string, string>, defaults?: Record<string, { target: string, addedIn: string }> }} FixtureManifest
 */

/**
 * Copy the compiled kit into a standalone directory so a test can alter its payload.
 * @param {(manifest: FixtureManifest, payloadRoot: string) => Promise<void> | void} mutate
 * @returns {Promise<string>} path to the copied cli.js
 */
async function createKitCopy(mutate) {
  const kitRoot = await mkdtemp(path.join(os.tmpdir(), 'drakom-kit-copy-'));
  await cp(path.join(repositoryRoot, 'dist'), path.join(kitRoot, 'dist'), { recursive: true });
  await cp(path.join(repositoryRoot, 'payload'), path.join(kitRoot, 'payload'), { recursive: true });
  await cp(path.join(repositoryRoot, 'package.json'), path.join(kitRoot, 'package.json'));
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(kitRoot, 'node_modules'), 'junction');
  const payloadRoot = path.join(kitRoot, 'payload', 'v1');
  const manifestPath = path.join(payloadRoot, 'payload.json');
  /** @type {FixtureManifest} */
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await mutate(manifest, payloadRoot);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path.join(kitRoot, 'dist', 'cli.js');
}

/**
 * Copy the compiled kit so a test can ship a different version of a payload file.
 * @param {string} source payload-relative path
 * @param {string} content
 * @returns {Promise<string>} path to the copied cli.js
 */
function createKitWithPayloadFile(source, content) {
  return createKitCopy((_manifest, payloadRoot) => writeFile(path.join(payloadRoot, ...source.split('/')), content, 'utf8'));
}

const exampleSkill = '.agents/skills/drakom-example-default/SKILL.md';
const exampleMirror = '.claude/skills/drakom-example-default/SKILL.md';
const exampleReference = '.agents/skills/drakom-example-default/references/example.md';
const exampleSkillContent = '---\nname: drakom-example-default\ndescription: Synthetic default skill\n---\n\n# Example\n';

/**
 * A kit that adds a default skill and reference in a release far newer than any fixture's.
 * @returns {Promise<string>} path to the copied cli.js
 */
function createKitWithNewDefaults() {
  return createKitCopy(async (manifest, payloadRoot) => {
    const skillDir = path.join(payloadRoot, 'skills', 'drakom-example-default');
    await mkdir(path.join(skillDir, 'references'), { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), exampleSkillContent, 'utf8');
    await writeFile(path.join(skillDir, 'references', 'example.md'), '# Example reference\n', 'utf8');
    manifest.files.exampleSkill = 'skills/drakom-example-default/SKILL.md';
    manifest.files.exampleReference = 'skills/drakom-example-default/references/example.md';
    manifest.defaults = {
      ...manifest.defaults,
      exampleSkill: { target: exampleSkill, addedIn: manifest.kitVersion },
      exampleReference: { target: exampleReference, addedIn: manifest.kitVersion },
    };
  });
}

/**
 * An installed target recorded at an older kit version, so newer defaults are offered.
 * @param {string} kitVersion
 */
async function createInstalledAt(kitVersion) {
  const root = await createInstalled();
  const state = await readState(root);
  state.kitVersion = kitVersion;
  await writeState(root, state);
  return root;
}

/**
 * A target where the example reference cannot be installed, so `kitVersion` is held back, while
 * the example skill is installed and managed.
 * @param {string} kitCli
 */
async function createHeldBackTarget(kitCli) {
  const root = await createInstalledAt('0.0.9');
  await mkdir(path.join(root, '.agents', 'skills', 'drakom-example-default', 'references'), { recursive: true });
  await write(root, exampleReference, '# Hand-written\n');
  const sync = run(kitCli, ['sync', root]);
  assert.equal(sync.status, 2, sync.stdout + sync.stderr);
  const state = await readState(root);
  assert.equal(state.kitVersion, '0.0.9');
  assert.ok(state.managedFiles[exampleSkill]);
  return root;
}

test('parses repeatable --accept and --release in both value forms', () => {
  assert.deepEqual(
    parseCliArgs(['sync', '--accept', 'a.md', 'project', '--accept=b.md', '--release', 'c.md', '--release=d=e.md', '--dry-run']),
    {
      command: 'sync',
      targetPath: 'project',
      dryRun: true,
      check: false,
      accept: ['a.md', 'b.md'],
      release: ['c.md', 'd=e.md'],
    },
  );
  assert.deepEqual(parseCliArgs(['sync', '--accept=-odd.md']), {
    command: 'sync',
    targetPath: '.',
    dryRun: false,
    check: false,
    accept: ['-odd.md'],
    release: [],
  });
});

test('rejects --accept and --release without a value, outside sync, or with --check', () => {
  assert.throws(() => parseCliArgs(['sync', '--accept']), /--accept requires a path/);
  assert.throws(() => parseCliArgs(['sync', '--accept', '--dry-run']), /--accept requires a path/);
  assert.throws(() => parseCliArgs(['sync', '--release=']), /--release requires a path/);
  assert.throws(() => parseCliArgs(['init', '--accept', 'a.md']), /--accept is available only with sync/);
  assert.throws(() => parseCliArgs(['init', '--release=a.md']), /--release is available only with sync/);
  assert.throws(() => parseCliArgs(['sync', '--check', '--accept', 'a.md']), /--check.*cannot be combined/);
  assert.throws(() => parseCliArgs(['sync', '--release', 'a.md', '--check']), /--check.*cannot be combined/);
  assert.throws(() => parseCliArgs(['sync', '--accepted', 'a.md']), /Unknown option --accepted/);
});

test('existing invocations parse exactly as before', () => {
  assert.deepEqual(parseCliArgs(['sync']), {
    command: 'sync',
    targetPath: '.',
    dryRun: false,
    check: false,
    accept: [],
    release: [],
  });
  assert.throws(() => parseCliArgs(['sync', '--dry-run', '--dry-run']), /only once/);
  assert.throws(() => parseCliArgs(['sync', 'a', 'b']), /Unexpected second target path: b/);
  assert.throws(() => parseCliArgs(['sync', '--dry-run=yes']), /Unknown option --dry-run=yes/);
});

test('sync help documents --accept, --release, and the partial apply', () => {
  const help = renderCliHelp('sync');
  assert.match(help, /--accept <path>/);
  assert.match(help, /--release <path>/);
  assert.match(help, /holds back only its own item/);
});

test('option paths normalise to POSIX form, including native Windows paths', () => {
  assert.equal(
    normalizeTargetRelativePath('.agents\\skills\\x\\SKILL.md', 'C:\\work\\repo', '--accept', path.win32),
    '.agents/skills/x/SKILL.md',
  );
  assert.equal(
    normalizeTargetRelativePath('./.agents/skills/x/SKILL.md', 'C:\\work\\repo', '--accept', path.win32),
    '.agents/skills/x/SKILL.md',
  );
  assert.equal(
    normalizeTargetRelativePath('C:\\work\\repo\\.agents\\skills\\x\\SKILL.md', 'C:\\work\\repo', '--release', path.win32),
    '.agents/skills/x/SKILL.md',
  );
  assert.equal(normalizeTargetRelativePath('./a/../b.md', '/work/repo', '--accept', path.posix), 'b.md');
  assert.throws(
    () => normalizeTargetRelativePath('..\\other\\x.md', 'C:\\work\\repo', '--accept', path.win32),
    /outside the target/,
  );
  assert.throws(() => normalizeTargetRelativePath('D:\\x.md', 'C:\\work\\repo', '--accept', path.win32), /outside the target/);
  assert.throws(() => normalizeTargetRelativePath('../x.md', '/work/repo', '--release', path.posix), /outside the target/);
  assert.throws(() => normalizeTargetRelativePath('.', '/work/repo', '--release', path.posix), /target directory itself/);
});

test('a conflicting managed file holds back only itself: the rest is applied and recorded, exit 2', async () => {
  const root = await createInstalled();
  const payload = await loadPackagePayload();
  await makeOutdated(root, ruleAnatomy);
  const stateBefore = await readState(root);
  stateBefore.kitVersion = '0.0.9';
  await writeState(root, stateBefore);
  await write(root, setupSkill, editedSkill);
  const mirrorBefore = await read(root, setupMirror);

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 2, sync.stdout + sync.stderr);
  assert.match(sync.stdout, /CONFLICT \.agents\/skills\/drakom-ai-setup\/SKILL\.md — Managed file was locally modified\./);
  assert.match(sync.stdout, /Restore the kit version, or run `drakom-ai sync --accept \.agents\/skills\/drakom-ai-setup\/SKILL\.md` to keep your edit, or `drakom-ai sync --release \.agents\/skills\/drakom-ai-setup\/SKILL\.md` to stop managing it\./);
  assert.match(sync.stdout, /UPDATE {3}\.agents\/skills\/drakom-ai-setup\/references\/rule-anatomy\.md/);
  assert.match(sync.stdout, /Result: 1 conflicting item to review; only conflicting items are held back\./);
  assert.match(
    sync.stdout,
    /Synchronized: 2 updated, 0 created, 0 deleted\. Conflict remains, left unchanged: \.agents\/skills\/drakom-ai-setup\/SKILL\.md\.\n$/,
  );
  assert.doesNotMatch(sync.stdout, /no changes made/);
  assert.doesNotMatch(sync.stdout, /state\.json by hand|--force|overwrite/i);

  assert.equal(await read(root, ruleAnatomy), payload.files.ruleAnatomy);
  assert.equal(await read(root, setupSkill), editedSkill);
  assert.equal(await read(root, setupMirror), mirrorBefore, 'the mirror of a conflicting skill is held back');
  const state = await readState(root);
  assert.equal(state.kitVersion, payload.manifest.kitVersion);
  assert.deepEqual(state.managedFiles[setupSkill], stateBefore.managedFiles[setupSkill]);
  assert.equal(state.managedFiles[ruleAnatomy].fingerprint, fingerprint(payload.files.ruleAnatomy ?? ''));

  // The conflict stays reported, with nothing left to apply, until it is resolved.
  const before = await snapshot(root);
  const again = drakom(['sync', root]);
  assert.equal(again.status, 2);
  assert.match(again.stdout, /Nothing else to synchronize; no changes made\. Conflict remains, left unchanged: \.agents\/skills\/drakom-ai-setup\/SKILL\.md\.\n$/);
  const check = drakom(['sync', root, '--check']);
  assert.equal(check.status, 2);
  assert.match(check.stderr, /Drift detected/);
  assert.deepEqual(await snapshot(root), before);

  // Restoring the kit version clears it.
  await write(root, setupSkill, payload.files.setupSkill ?? '');
  assert.equal(drakom(['sync', root, '--check']).status, 0);
});

test('a missing managed file is a conflict that points to --release, and other work still applies', async () => {
  const root = await createInstalled();
  const payload = await loadPackagePayload();
  await makeOutdated(root, ruleAnatomy);
  await rm(path.join(root, ...setupSkill.split('/')));

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 2, sync.stdout);
  assert.match(sync.stdout, /CONFLICT \.agents\/skills\/drakom-ai-setup\/SKILL\.md — Managed file is missing\. Restore it, or run `drakom-ai sync --release \.agents\/skills\/drakom-ai-setup\/SKILL\.md` to stop managing it\./);
  assert.doesNotMatch(sync.stdout, /--accept/);
  assert.equal(await read(root, ruleAnatomy), payload.files.ruleAnatomy);
  assert.equal(
    await read(root, setupMirror),
    createMirrorContent(payload.files.setupSkill ?? ''),
    'the mirror of a missing kit skill is not deleted while the conflict is open',
  );
});

test('a managed block conflict and an MCP conflict do not stop a managed file update', async () => {
  const root = await createInstalled();
  const payload = await loadPackagePayload();
  await makeOutdated(root, ruleAnatomy);
  const agents = await read(root, 'AGENTS.md');
  await write(root, 'AGENTS.md', agents.replace('Drakom AI Development Context', 'My heading'));
  await write(root, `${DRAKOM_DIR}/mcp-servers.yaml`, 'servers: [unclosed\n');

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 2, sync.stdout);
  assert.match(sync.stdout, /CONFLICT AGENTS\.md/);
  assert.match(sync.stdout, /CONFLICT \.drakom-ai\/mcp-servers\.yaml/);
  assert.match(sync.stdout, /Result: 2 conflicting items to review/);
  assert.match(sync.stdout, /Conflicts remain, left unchanged: AGENTS\.md, \.drakom-ai\/mcp-servers\.yaml\./);
  assert.equal(await read(root, ruleAnatomy), payload.files.ruleAnatomy);
  assert.equal(await read(root, 'AGENTS.md'), agents.replace('Drakom AI Development Context', 'My heading'));
});

test('an MCP conflict holds back every MCP client file, and nothing else', async () => {
  const root = await createInstalled();
  const payload = await loadPackagePayload();
  await makeOutdated(root, ruleAnatomy);
  await write(root, `${DRAKOM_DIR}/mcp-servers.yaml`, 'servers:\n  tools:\n    command: node\n    args: [server.mjs]\n');
  const unmanaged = '{"mcpServers":{"tools":{"command":"python","args":["other.py"]}}}\n';
  await write(root, '.mcp.json', unmanaged);

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 2, sync.stdout);
  assert.match(sync.stdout, /CONFLICT \.mcp\.json/);
  assert.doesNotMatch(sync.stdout, /CREATE.*(mcp|config\.toml)/);
  assert.equal(await read(root, '.mcp.json'), unmanaged);
  await assert.rejects(read(root, '.vscode/mcp.json'), /ENOENT/);
  await assert.rejects(read(root, '.codex/config.toml'), /ENOENT/);
  assert.deepEqual((await readState(root)).managedMcpServers, {});
  assert.equal(await read(root, ruleAnatomy), payload.files.ruleAnatomy);

  // Once the MCP conflict is gone, the client files are generated.
  await rm(path.join(root, '.mcp.json'));
  const retry = drakom(['sync', root]);
  assert.equal(retry.status, 0, retry.stdout);
  assert.match(await read(root, '.vscode/mcp.json'), /server\.mjs/);
});

test('--accept keeps a local edit: no conflict, no drift, and later syncs never overwrite it', async () => {
  const root = await createInstalled();
  const payload = await loadPackagePayload();
  await write(root, setupSkill, editedSkill);

  const accept = drakom(['sync', root, '--accept', setupSkill]);

  assert.equal(accept.status, 0, accept.stdout + accept.stderr);
  assert.match(accept.stdout, /PRESERVE \.agents\/skills\/drakom-ai-setup\/SKILL\.md — Local edit accepted/);
  assert.match(accept.stdout, /Result: ready\./);
  assert.equal(await read(root, setupSkill), editedSkill);
  const state = await readState(root);
  assert.deepEqual(state.managedFiles[setupSkill], {
    source: 'skills/drakom-ai-setup/SKILL.md',
    fingerprint: fingerprint(payload.files.setupSkill ?? ''),
    acceptedFingerprint: fingerprint(editedSkill),
  });
  assert.equal(await read(root, setupMirror), createMirrorContent(editedSkill), 'the mirror follows the accepted edit');

  const afterAccept = await snapshot(root);
  const check = drakom(['sync', root, '--check']);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /Accepted local edit is kept/);
  const sync = drakom(['sync', root]);
  assert.equal(sync.status, 0, sync.stdout);
  assert.match(sync.stdout, /already up to date; no changes made/);
  assert.equal(await read(root, setupSkill), editedSkill, 'a later sync must not overwrite the accepted edit');
  assert.deepEqual(await snapshot(root), afterAccept);

  // Accepting again is harmless and changes nothing.
  assert.equal(drakom(['sync', root, `--accept=${setupSkill}`]).status, 0);
  assert.deepEqual(await snapshot(root), afterAccept);
  assert.equal((await loadState(root))?.managedFiles[setupSkill]?.acceptedFingerprint, fingerprint(editedSkill));
});

test('an accepted edit conflicts again when the kit changes that file, and can be accepted again', async () => {
  const root = await createInstalled();
  await write(root, setupSkill, editedSkill);
  assert.equal(drakom(['sync', root, '--accept', setupSkill]).status, 0);
  const newKitSkill = '---\nname: drakom-ai-setup\ndescription: Newer kit\n---\n\n# Newer kit skill\n';
  const newerKit = await createKitWithPayloadFile('skills/drakom-ai-setup/SKILL.md', newKitSkill);
  const before = await snapshot(root);

  const sync = run(newerKit, ['sync', root]);

  assert.equal(sync.status, 2, sync.stdout + sync.stderr);
  assert.match(sync.stdout, /CONFLICT \.agents\/skills\/drakom-ai-setup\/SKILL\.md — Kit version \S+ changed this file, which has an accepted local edit\./);
  assert.match(sync.stdout, /payload\/v1\/skills\/drakom-ai-setup\/SKILL\.md/);
  assert.match(sync.stdout, /sync --accept \.agents\/skills\/drakom-ai-setup\/SKILL\.md/);
  assert.match(sync.stdout, /sync --release \.agents\/skills\/drakom-ai-setup\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
  assert.equal(run(newerKit, ['sync', root, '--check']).status, 2);

  const reaccept = run(newerKit, ['sync', root, '--accept', setupSkill]);
  assert.equal(reaccept.status, 0, reaccept.stdout + reaccept.stderr);
  assert.equal(await read(root, setupSkill), editedSkill);
  assert.deepEqual((await readState(root)).managedFiles[setupSkill], {
    source: 'skills/drakom-ai-setup/SKILL.md',
    fingerprint: fingerprint(newKitSkill),
    acceptedFingerprint: fingerprint(editedSkill),
  });
  assert.equal(run(newerKit, ['sync', root, '--check']).status, 0);
});

test('editing a file again after accepting it is a local-modification conflict', async () => {
  const root = await createInstalled();
  await write(root, setupSkill, editedSkill);
  assert.equal(drakom(['sync', root, '--accept', setupSkill]).status, 0);
  await write(root, setupSkill, `${editedSkill}\nOne more line.\n`);
  const before = await snapshot(root);

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 2, sync.stdout);
  assert.match(sync.stdout, /CONFLICT \.agents\/skills\/drakom-ai-setup\/SKILL\.md — Managed file was edited again after its local edit was accepted\./);
  assert.match(sync.stdout, /sync --accept \.agents\/skills\/drakom-ai-setup\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('restoring the kit version of an accepted file drops the accepted-edit record', async () => {
  const root = await createInstalled();
  const payload = await loadPackagePayload();
  const stateBefore = await readState(root);
  await write(root, setupSkill, editedSkill);
  assert.equal(drakom(['sync', root, '--accept', setupSkill]).status, 0);
  await write(root, setupSkill, payload.files.setupSkill ?? '');

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 0, sync.stdout);
  assert.deepEqual((await readState(root)).managedFiles[setupSkill], stateBefore.managedFiles[setupSkill]);
  assert.equal(drakom(['sync', root, '--check']).status, 0);
});

test('a modified file that already matches the current kit version is recorded, not reported', async () => {
  const root = await createInstalled();
  const payload = await loadPackagePayload();
  const state = await readState(root);
  state.managedFiles[ruleAnatomy].fingerprint = fingerprint('# What an older kit installed\n');
  await writeState(root, state);

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 0, sync.stdout);
  assert.match(sync.stdout, /PRESERVE \.agents\/skills\/drakom-ai-setup\/references\/rule-anatomy\.md — Kit-managed file already matches kit version/);
  assert.equal((await readState(root)).managedFiles[ruleAnatomy].fingerprint, fingerprint(payload.files.ruleAnatomy ?? ''));
});

test('--release stops managing an edited file and leaves it alone, with a warning that is not drift', async () => {
  const root = await createInstalled();
  await write(root, ruleAnatomy, '# My own rule anatomy\n');

  const release = drakom(['sync', root, '--release', ruleAnatomy]);

  assert.equal(release.status, 0, release.stdout + release.stderr);
  assert.match(release.stdout, /PRESERVE \.agents\/skills\/drakom-ai-setup\/references\/rule-anatomy\.md — Released from kit management; the file is left as it is/);
  assert.equal(await read(root, ruleAnatomy), '# My own rule anatomy\n');
  assert.equal(Object.hasOwn((await readState(root)).managedFiles, ruleAnatomy), false);

  const after = await snapshot(root);
  const sync = drakom(['sync', root]);
  assert.equal(sync.status, 0, sync.stdout);
  assert.match(sync.stdout, /WARNING {2}\.agents\/skills\/drakom-ai-setup\/references\/rule-anatomy\.md — Not managed by the kit and differs from kit version/);
  assert.match(sync.stdout, /Result: ready\./);
  const check = drakom(['sync', root, '--check']);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /WARNING/);
  assert.match(check.stdout, /No drift detected/);
  assert.deepEqual(await snapshot(root), after);

  // Releasing it twice is an error, not a silent no-op.
  const twice = drakom(['sync', root, '--release', ruleAnatomy]);
  assert.equal(twice.status, 1);
  assert.match(twice.stderr, /not a kit-managed file/);
});

test('--release accepts a deliberately deleted managed file and the kit does not recreate it', async () => {
  const root = await createInstalled();
  await rm(path.join(root, ...ruleAnatomy.split('/')));
  assert.equal(drakom(['sync', root]).status, 2);

  const release = drakom(['sync', root, `--release=${ruleAnatomy}`]);

  assert.equal(release.status, 0, release.stdout + release.stderr);
  assert.match(release.stdout, /Released from kit management; the file stays absent/);
  assert.equal(Object.hasOwn((await readState(root)).managedFiles, ruleAnatomy), false);
  const sync = drakom(['sync', root]);
  assert.equal(sync.status, 0, sync.stdout);
  assert.doesNotMatch(sync.stdout, /WARNING|CONFLICT/);
  assert.equal(drakom(['sync', root, '--check']).status, 0);
  await assert.rejects(read(root, ruleAnatomy), /ENOENT/);
});

test('releasing a kit skill that was deleted removes its Claude mirror', async () => {
  const root = await createInstalled();
  await rm(path.join(root, '.agents', 'skills', 'drakom-plan-audit'), { recursive: true });

  const release = drakom(['sync', root, '--release', '.agents/skills/drakom-plan-audit/SKILL.md']);

  assert.equal(release.status, 0, release.stdout + release.stderr);
  await assert.rejects(read(root, '.claude/skills/drakom-plan-audit/SKILL.md'), /ENOENT/);
  assert.equal(drakom(['sync', root, '--check']).status, 0);
});

test('--accept and --release resolve several files in one run', async () => {
  const root = await createInstalled();
  await write(root, setupSkill, editedSkill);
  await write(root, ruleAnatomy, '# Mine\n');
  assert.equal(drakom(['sync', root]).status, 2);

  const sync = drakom(['sync', root, '--accept', setupSkill, '--release', ruleAnatomy]);

  assert.equal(sync.status, 0, sync.stdout + sync.stderr);
  assert.equal(await read(root, setupSkill), editedSkill);
  assert.equal(await read(root, ruleAnatomy), '# Mine\n');
  assert.equal(drakom(['sync', root, '--check']).status, 0);
});

test('--accept and --release reject every path that is not a resolvable managed file', async () => {
  const root = await createInstalled();
  await write(root, '.mcp.json', '{"mcpServers":{}}\n');
  await write(root, 'README.md', '# Project\n');
  await write(root, setupSkill, editedSkill);
  await rm(path.join(root, ...ruleAnatomy.split('/')));
  const before = await snapshot(root);
  /** @type {Array<[string[], RegExp]>} */
  const cases = [
    [['--accept', setupMirror], /--accept \.claude\/skills\/drakom-ai-setup\/SKILL\.md: it is a generated Claude skill mirror/],
    [['--release', setupMirror], /generated Claude skill mirror/],
    [['--accept', 'AGENTS.md'], /--accept AGENTS\.md: the kit manages only a marked block inside it/],
    [['--release', 'AGENTS.md'], /marked block/],
    [['--accept', '.mcp.json'], /--accept \.mcp\.json: it is an MCP client file generated from \.drakom-ai\/mcp-servers\.yaml/],
    [['--release', '.codex/config.toml'], /MCP client file/],
    [['--accept', 'README.md'], /--accept README\.md: it is not a kit-managed file/],
    [['--release', 'does/not/exist.md'], /--release does\/not\/exist\.md: it is not a kit-managed file/],
    [['--release', `${DRAKOM_DIR}/state.json`], /not a kit-managed file/],
    [['--accept', '../elsewhere/SKILL.md'], /outside the target/],
    [['--release', path.join(os.tmpdir(), 'elsewhere.md')], /outside the target/],
    [['--accept', ruleAnatomy], /the file is missing, so there is no local edit to keep\. Restore it, or run `drakom-ai sync --release/],
    [['--accept', setupSkill, '--release', setupSkill], /both --accept and --release/],
    [['--accept', '.agents/skills/drakom-plan-audit/SKILL.md'], /matches the kit version, so there is no local edit to accept/],
    [['--accept', '.agents/skills/drakom-ai-setup/skill.md'], /not a kit-managed file.*Did you mean \.agents\/skills\/drakom-ai-setup\/SKILL\.md\?/],
  ];

  for (const [options, expected] of cases) {
    const result = drakom(['sync', root, ...options]);
    assert.equal(result.status, 1, `${options.join(' ')}: ${result.stdout}`);
    assert.match(result.stderr, expected);
    assert.match(result.stderr, /^drakom-ai: /);
    assert.equal(result.stdout, '', 'nothing is planned or printed before the option error');
  }
  assert.deepEqual(await snapshot(root), before);
});

test('--accept and --release take the native path form of the platform', async () => {
  const root = await createInstalled();
  await write(root, setupSkill, editedSkill);
  await write(root, ruleAnatomy, '# Mine\n');

  const sync = drakom([
    'sync',
    root,
    '--accept',
    setupSkill.split('/').join(path.sep),
    '--release',
    path.join(root, ...ruleAnatomy.split('/')),
  ]);

  assert.equal(sync.status, 0, sync.stdout + sync.stderr);
  const state = await readState(root);
  assert.equal(state.managedFiles[setupSkill].acceptedFingerprint, fingerprint(editedSkill));
  assert.equal(Object.hasOwn(state.managedFiles, ruleAnatomy), false);
  const rows = sync.stdout.split('\n').filter((line) => line.includes(' — '));
  assert.doesNotMatch(rows.join('\n'), /\\/, 'plan rows print POSIX paths');
});

test('--dry-run previews --accept and --release without writing', async () => {
  const root = await createInstalled();
  await write(root, setupSkill, editedSkill);
  await write(root, ruleAnatomy, '# Mine\n');
  const before = await snapshot(root);

  const dry = drakom(['sync', root, '--dry-run', '--accept', setupSkill, '--release', ruleAnatomy]);

  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /Local edit accepted/);
  assert.match(dry.stdout, /Released from kit management/);
  assert.match(dry.stdout, /UPDATE {3}\.drakom-ai\/state\.json/);
  assert.match(dry.stdout, /Dry run; no changes made\.\n$/);
  assert.deepEqual(await snapshot(root), before);

  // Without the options the same dry run reports the conflicts and exits 2.
  const dryConflicts = drakom(['sync', root, '--dry-run']);
  assert.equal(dryConflicts.status, 2);
  assert.match(dryConflicts.stdout, /Result: 2 conflicting items to review/);
  assert.match(dryConflicts.stdout, /Dry run; no changes made\.\n$/);
  assert.deepEqual(await snapshot(root), before);
});

test('a kit file the project owns is a warning, never drift or a conflict', async () => {
  const root = await createInstalled();
  const state = await readState(root);
  delete state.managedFiles[ruleAnatomy];
  await writeState(root, state);
  assert.doesNotMatch(drakom(['sync', root]).stdout, /WARNING/, 'an identical unmanaged copy is not worth a warning');
  await write(root, ruleAnatomy, '# Project-owned from the start\n');

  const check = drakom(['sync', root, '--check']);

  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /WARNING {2}\.agents\/skills\/drakom-ai-setup\/references\/rule-anatomy\.md/);
  assert.equal(drakom(['sync', root]).status, 0);
  assert.equal(await read(root, ruleAnatomy), '# Project-owned from the start\n');
});

test('state files load unchanged, keep a valid accepted-edit field, and reject a malformed one', async () => {
  const root = await createInstalled();
  const original = await read(root, `${DRAKOM_DIR}/state.json`);
  assert.doesNotMatch(original, /acceptedFingerprint|releasedFiles/);
  assert.equal(JSON.parse(original).schemaVersion, 1);
  assert.equal(drakom(['sync', root]).status, 0);
  assert.equal(await read(root, `${DRAKOM_DIR}/state.json`), original, 'an existing state file is not rewritten');

  const state = JSON.parse(original);
  state.managedFiles[setupSkill].acceptedFingerprint = fingerprint('mine');
  state.releasedFiles = ['b/released.md', 'a/released.md'];
  await writeState(root, state);
  const loaded = await loadState(root);
  assert.equal(loaded?.managedFiles[setupSkill]?.acceptedFingerprint, fingerprint('mine'));
  assert.deepEqual(loaded?.releasedFiles, ['b/released.md', 'a/released.md']);
  assert.equal(loaded?.schemaVersion, 1);
  assert.ok(loaded);
  assert.match(serializeState(loaded), /"releasedFiles": \[\n {4}"a\/released\.md",\n {4}"b\/released\.md"\n {2}\]/);
  assert.doesNotMatch(serializeState({ ...loaded, releasedFiles: [] }), /releasedFiles/);

  state.managedFiles[setupSkill].acceptedFingerprint = 'not-a-fingerprint';
  await writeState(root, state);
  await assert.rejects(loadState(root), /invalid managedFiles entry for \.agents\/skills\/drakom-ai-setup\/SKILL\.md/);
  delete state.managedFiles[setupSkill].acceptedFingerprint;
  for (const invalid of ['a.md', ['../a.md'], [3]]) {
    state.releasedFiles = invalid;
    await writeState(root, state);
    await assert.rejects(loadState(root), /releasedFiles/);
  }
});

test('a CLI that does not know the accepted-edit field reports a conflict and never overwrites the edit', async () => {
  const root = await createInstalled();
  await write(root, setupSkill, editedSkill);
  assert.equal(drakom(['sync', root, '--accept', setupSkill]).status, 0);
  // An older CLI drops fields it does not know when it loads state.
  const state = await readState(root);
  delete state.managedFiles[setupSkill].acceptedFingerprint;
  await writeState(root, state);
  const before = await snapshot(root);

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 2, sync.stdout);
  assert.match(sync.stdout, /CONFLICT \.agents\/skills\/drakom-ai-setup\/SKILL\.md — Managed file was locally modified\./);
  assert.doesNotMatch(sync.stdout, /UPDATE {3}\.agents\/skills\/drakom-ai-setup\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('accepting an edit to an outdated file records the current kit version as its baseline', async () => {
  const root = await createInstalled();
  const payload = await loadPackagePayload();
  await makeOutdated(root, setupSkill);
  await write(root, setupSkill, editedSkill);

  const accept = drakom(['sync', root, '--accept', setupSkill]);

  assert.equal(accept.status, 0, accept.stdout + accept.stderr);
  assert.deepEqual((await readState(root)).managedFiles[setupSkill], {
    source: 'skills/drakom-ai-setup/SKILL.md',
    fingerprint: fingerprint(payload.files.setupSkill ?? ''),
    acceptedFingerprint: fingerprint(editedSkill),
  });
  assert.equal(drakom(['sync', root, '--check']).status, 0);
  assert.equal(await read(root, setupSkill), editedSkill);
});

test('--accept refuses an unedited file that is only outdated', async () => {
  const root = await createInstalled();
  await makeOutdated(root, ruleAnatomy);
  const before = await snapshot(root);

  const accept = drakom(['sync', root, '--accept', ruleAnatomy]);

  assert.equal(accept.status, 1, accept.stdout);
  assert.match(accept.stderr, /has no local edit to accept; it is only behind the kit version\. Run `drakom-ai sync` to take the update, or `drakom-ai sync --release \.agents\/skills\/drakom-ai-setup\/references\/rule-anatomy\.md` to stop managing it\./);
  assert.deepEqual(await snapshot(root), before);
});

test('--accept refuses a starter file that an older kit recorded as managed', async () => {
  const root = await createInstalled();
  const starter = `${DRAKOM_DIR}/rules/README.md`;
  await write(root, starter, '# Our rules\n');
  const state = await readState(root);
  state.managedFiles[starter] = { source: 'templates/rules.README.md', fingerprint: fingerprint('# Kit starter\n') };
  await writeState(root, state);
  const before = await snapshot(root);

  const accept = drakom(['sync', root, '--accept', starter]);

  assert.equal(accept.status, 1, accept.stdout);
  assert.match(accept.stderr, /starter file that is already project-owned/);
  assert.deepEqual(await snapshot(root), before);
});

test('a released file is recorded and stays released while kitVersion is held back: deleted', async () => {
  const kitCli = await createKitWithNewDefaults();
  const root = await createHeldBackTarget(kitCli);
  await rm(path.join(root, ...exampleSkill.split('/')));

  const release = run(kitCli, ['sync', root, '--release', exampleSkill]);

  assert.equal(release.status, 2, 'the reference conflict is still open');
  assert.doesNotMatch(release.stdout, /CREATE {3}\.agents\/skills\/drakom-example-default\/SKILL\.md/);
  const state = await readState(root);
  assert.equal(state.kitVersion, '0.0.9');
  assert.deepEqual(state.releasedFiles, [exampleSkill]);
  assert.equal(Object.hasOwn(state.managedFiles, exampleSkill), false);

  const sync = run(kitCli, ['sync', root]);
  assert.doesNotMatch(sync.stdout, /drakom-example-default\/SKILL\.md/);
  await assert.rejects(read(root, exampleSkill), /ENOENT/);
  assert.equal(Object.hasOwn((await readState(root)).managedFiles, exampleSkill), false);
});

test('a released file is recorded and stays released while kitVersion is held back: edited', async () => {
  const kitCli = await createKitWithNewDefaults();
  const root = await createHeldBackTarget(kitCli);
  await write(root, exampleSkill, `${exampleSkillContent}\nOurs now.\n`);
  assert.equal(run(kitCli, ['sync', root, '--release', exampleSkill]).status, 2);

  const sync = run(kitCli, ['sync', root]);

  assert.doesNotMatch(sync.stdout, /CONFLICT \.agents\/skills\/drakom-example-default\/SKILL\.md/);
  assert.match(sync.stdout, /WARNING {2}\.agents\/skills\/drakom-example-default\/SKILL\.md — Not managed by the kit/);
  assert.match(sync.stdout, /Result: 1 conflicting item to review/);
  assert.equal(await read(root, exampleSkill), `${exampleSkillContent}\nOurs now.\n`);
  assert.equal(Object.hasOwn((await readState(root)).managedFiles, exampleSkill), false);

  // Freeing the blocked path completes the upgrade; the released file is still left alone.
  await rm(path.join(root, ...exampleReference.split('/')));
  const done = run(kitCli, ['sync', root]);
  assert.equal(done.status, 0, done.stdout);
  assert.notEqual((await readState(root)).kitVersion, '0.0.9');
  assert.equal(await read(root, exampleSkill), `${exampleSkillContent}\nOurs now.\n`);
  assert.equal(run(kitCli, ['sync', root, '--check']).status, 0);
});

test('an unmanaged file at a new default path is one conflict row, without a warning row as well', async () => {
  const kitCli = await createKitWithNewDefaults();
  const root = await createInstalledAt('0.0.9');
  await mkdir(path.join(root, '.agents', 'skills', 'drakom-example-default', 'references'), { recursive: true });
  await write(root, exampleReference, '# Hand-written\n');

  const sync = run(kitCli, ['sync', root, '--dry-run']);

  assert.match(sync.stdout, /CONFLICT \.agents\/skills\/drakom-example-default\/references\/example\.md — Unmanaged path occupies a default file/);
  assert.doesNotMatch(sync.stdout, /before synchronizing/);
  assert.doesNotMatch(sync.stdout, /WARNING/);
});

test('a default skill whose folder is a symlink gets no file, no record, and no Claude mirror', async () => {
  const kitCli = await createKitWithNewDefaults();
  const root = await createInstalledAt('0.0.9');
  await mkdir(path.join(root, 'elsewhere'));
  await symlink(path.join('..', '..', 'elsewhere'), path.join(root, '.agents', 'skills', 'drakom-example-default'), 'dir');

  const sync = run(kitCli, ['sync', root]);

  assert.equal(sync.status, 2, sync.stdout + sync.stderr);
  assert.match(sync.stdout, /CONFLICT \.agents\/skills\/drakom-example-default — Symlink to/);
  assert.doesNotMatch(sync.stdout, /CREATE {3}\.claude\/skills\/drakom-example-default/);
  await assert.rejects(read(root, exampleMirror), /ENOENT/);
  assert.deepEqual(await readdir(path.join(root, 'elsewhere')), []);
  const state = await readState(root);
  assert.equal(Object.hasOwn(state.managedFiles, exampleSkill), false);
  assert.equal(Object.hasOwn(state.managedFiles, exampleReference), false);
  assert.equal(Object.hasOwn(state.managedSkillMirrors, exampleMirror), false);
  assert.equal(state.kitVersion, '0.0.9');
});

test('nothing is applied when the state file cannot be written', async () => {
  const root = await createInstalled();
  await makeOutdated(root, ruleAnatomy);
  await cp(path.join(root, DRAKOM_DIR), path.join(root, 'drakom-real'), { recursive: true });
  await rm(path.join(root, DRAKOM_DIR), { recursive: true });
  await symlink('drakom-real', path.join(root, DRAKOM_DIR), 'dir');

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 2, sync.stdout + sync.stderr);
  assert.match(sync.stdout, /UPDATE {3}\.agents\/skills\/drakom-ai-setup\/references\/rule-anatomy\.md/);
  assert.match(sync.stdout, /Result: review conflicts; no changes made\.\n$/);
  assert.equal(await read(root, ruleAnatomy), '# Older kit content\n', 'an update that cannot be recorded is not applied');
});

test('a refused MCP client file holds back the other MCP client files and their records', async () => {
  const root = await createInstalled();
  await write(root, `${DRAKOM_DIR}/mcp-servers.yaml`, 'servers:\n  tools:\n    command: node\n    args: [server.mjs]\n');
  await mkdir(path.join(root, 'editor-config'));
  await symlink('editor-config', path.join(root, '.vscode'), 'dir');

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 2, sync.stdout + sync.stderr);
  assert.match(sync.stdout, /CONFLICT \.vscode — Symlink to/);
  await assert.rejects(read(root, '.mcp.json'), /ENOENT/);
  await assert.rejects(read(root, '.codex/config.toml'), /ENOENT/);
  assert.deepEqual(await readdir(path.join(root, 'editor-config')), []);
  assert.deepEqual((await readState(root)).managedMcpServers, {});
});

test('the result line counts conflicting items the same way the final line lists them', async () => {
  const root = await createInstalled();
  await write(
    root,
    `${DRAKOM_DIR}/mcp-servers.yaml`,
    'servers:\n  one:\n    command: node\n    env:\n      API_TOKEN: literal-value\n  two:\n    command: node\n    env:\n      API_TOKEN: literal-value\n',
  );

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 2, sync.stdout);
  assert.equal(sync.stdout.split('\n').filter((line) => line.startsWith('CONFLICT')).length, 2);
  assert.match(sync.stdout, /Result: 1 conflicting item to review/);
  assert.match(sync.stdout, /Conflict remains, left unchanged: \.drakom-ai\/mcp-servers\.yaml\.\n$/);
});

test('block, mirror and release rows name a next step that fits a sync that carries on', async () => {
  const root = await createInstalled();
  const agents = await read(root, 'AGENTS.md');
  await write(root, 'AGENTS.md', agents.replace('Drakom AI Development Context', 'My heading'));
  await write(root, setupMirror, `${await read(root, setupMirror)}\nEdited mirror.\n`);
  await rm(path.join(root, ...ruleAnatomy.split('/')));
  await mkdir(path.join(root, ...ruleAnatomy.split('/')));

  const sync = drakom(['sync', root, '--release', ruleAnatomy]);

  assert.equal(sync.status, 2, sync.stdout + sync.stderr);
  assert.doesNotMatch(sync.stdout, /before synchronizing/);
  assert.match(sync.stdout, /CONFLICT AGENTS\.md — Managed block <!-- drakom-ai:start --> was locally modified\. Restore the block/);
  assert.match(sync.stdout, /CONFLICT \.claude\/skills\/drakom-ai-setup\/SKILL\.md — Claude skill mirror for drakom-ai-setup was locally modified\. .*delete the folder \.claude\/skills\/drakom-ai-setup/);
  assert.match(sync.stdout, /rule-anatomy\.md — Released from kit management; what is at this path is left as it is/);
});

test('a path that only misses the target-relative form gets a hint, not just a refusal', async () => {
  const root = await createInstalled();
  await write(root, setupSkill, editedSkill);
  const before = await snapshot(root);

  // Typed relative to the current directory instead of the target.
  const fromSubdirectory = spawnSync(
    process.execPath,
    [cliPath, 'sync', '..', '--accept', path.join('skills', 'drakom-ai-setup', 'SKILL.md')],
    { encoding: 'utf8', cwd: path.join(root, '.agents') },
  );
  assert.equal(fromSubdirectory.status, 1, fromSubdirectory.stdout);
  assert.match(
    fromSubdirectory.stderr,
    /--accept skills\/drakom-ai-setup\/SKILL\.md: it is not a kit-managed file.*Did you mean \.agents\/skills\/drakom-ai-setup\/SKILL\.md\? Paths are relative to the target, not the current directory\./,
  );

  const wrongCase = drakom(['sync', root, '--release', '.agents/skills/drakom-ai-setup/skill.md']);
  assert.equal(wrongCase.status, 1);
  assert.match(wrongCase.stderr, /Did you mean \.agents\/skills\/drakom-ai-setup\/SKILL\.md\?/);
  assert.deepEqual(await snapshot(root), before);
});

test('an absolute path reaches its managed file through a differently spelled route to the target', async () => {
  const root = await createInstalled();
  await write(root, setupSkill, editedSkill);
  const aliasParent = await mkdtemp(path.join(os.tmpdir(), 'drakom-alias-'));
  const alias = path.join(aliasParent, 'link');
  await symlink(root, alias, 'junction');

  // The file is named through its real path, then through a link to the target.
  const viaRealPath = drakom(['sync', root, '--dry-run', '--accept', path.join(await realpath(root), ...setupSkill.split('/'))]);
  assert.equal(viaRealPath.status, 0, viaRealPath.stdout + viaRealPath.stderr);
  assert.match(viaRealPath.stdout, /Local edit accepted/);
  const viaLinkFile = drakom(['sync', root, '--accept', path.join(alias, ...setupSkill.split('/'))]);
  assert.equal(viaLinkFile.status, 0, viaLinkFile.stdout + viaLinkFile.stderr);
  assert.equal((await readState(root)).managedFiles[setupSkill].acceptedFingerprint, fingerprint(editedSkill));
});
