import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DRAKOM_DIR } from '../dist/constants.js';
import { createMirrorContent, MANAGED_BLOCK, NOTICE } from '../dist/operation-plan.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');
const statePath = `${DRAKOM_DIR}/state.json`;
const setupSkill = '.agents/skills/drakom-ai-setup/SKILL.md';
const setupMirror = '.claude/skills/drakom-ai-setup/SKILL.md';

/**
 * A hash of the exact bytes, as 0.5.0 and earlier recorded it.
 * @param {string} content
 */
function fingerprint(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * The fingerprint this version records: CRLF read as LF.
 * @param {string} content
 */
function lfFingerprint(content) {
  return fingerprint(content.replaceAll('\r\n', '\n'));
}

/** @param {string} text */
function toCrlf(text) {
  return text.replace(/\r?\n/g, '\r\n');
}

/**
 * Every line ending is CRLF.
 * @param {string} text
 * @param {string} label
 */
function assertOnlyCrlf(text, label) {
  assert.doesNotMatch(text, /(^|[^\r])\n/, `${label} has a bare LF line ending`);
}

/**
 * @param {string[]} args
 * @param {string} [input] answers to the prompt
 */
function drakom(args, input) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', input });
}

/**
 * @param {import('node:test').TestContext} t
 * @returns {Promise<string>}
 */
async function tempTarget(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drakom-eol-'));
  t.after(() => rm(root, { recursive: true, force: true }));
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
async function write(root, relativePath, content) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

/**
 * Every regular file under the root, as root-relative POSIX paths.
 * @param {string} root
 * @param {string} [relativeDirectory]
 * @returns {Promise<string[]>}
 */
async function listFiles(root, relativeDirectory = '') {
  const entries = await readdir(path.join(root, ...relativeDirectory.split('/').filter(Boolean)), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, relativePath)));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files.sort();
}

/**
 * Convert every file to CRLF, as a checkout with core.autocrlf=true does.
 * @param {string} root
 */
async function convertTreeToCrlf(root) {
  for (const relativePath of await listFiles(root)) {
    await write(root, relativePath, toCrlf(await read(root, relativePath)));
  }
}

/**
 * Convert every file to LF, as a checkout on Linux or macOS does.
 * @param {string} root
 */
async function convertTreeToLf(root) {
  for (const relativePath of await listFiles(root)) {
    await write(root, relativePath, (await read(root, relativePath)).replaceAll('\r\n', '\n'));
  }
}

/**
 * After a fresh checkout as all-LF and as all-CRLF, the installation is clean with no write.
 * @param {string} root
 */
async function assertCleanOnEveryCheckout(root) {
  for (const [label, convert] of /** @type {const} */ ([['LF', convertTreeToLf], ['CRLF', convertTreeToCrlf]])) {
    await convert(root);
    const check = drakom(['sync', root, '--check']);
    assert.equal(check.status, 0, `${label} checkout: ${check.stdout}${check.stderr}`);
  }
}

/** A Claude mirror as 0.5.0 wrote it for a CRLF skill: an LF notice inside CRLF text. @param {string} skill */
function mixedMirrorOf(skill) {
  const frontmatter = skill.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? '';
  return `${frontmatter}\n${NOTICE}\n\n${skill.slice(frontmatter.length)}`;
}

/** @param {string} root */
async function snapshot(root) {
  /** @type {Record<string, string>} */
  const files = {};
  for (const relativePath of await listFiles(root)) files[relativePath] = await read(root, relativePath);
  return files;
}

test('a Claude mirror of a CRLF skill is CRLF throughout, and an LF skill gives an LF mirror', () => {
  const crlfSkill = '---\r\nname: mine\r\ndescription: Mine\r\n---\r\n\r\n# Mine\r\n';
  const lfSkill = crlfSkill.replaceAll('\r\n', '\n');

  assertOnlyCrlf(createMirrorContent(crlfSkill), 'the mirror of a CRLF skill with frontmatter');
  assertOnlyCrlf(createMirrorContent('# Mine\r\n'), 'the mirror of a CRLF skill without frontmatter');
  assert.doesNotMatch(createMirrorContent(lfSkill), /\r/);
  assert.equal(createMirrorContent(crlfSkill).replaceAll('\r\n', '\n'), createMirrorContent(lfSkill));
});

test('init and sync keep the CRLF line endings of the files they append to and mirror', async (t) => {
  const root = await tempTarget(t);
  await write(root, 'AGENTS.md', '# Project\r\n\r\nOur notes.\r\n');
  await write(root, 'CLAUDE.md', '# Claude\r\n\r\nClaude notes.\r\n');
  await write(root, '.worktreeinclude', 'node_modules/\r\n');
  await write(root, '.agents/skills/mine/SKILL.md', '---\r\nname: mine\r\ndescription: Mine\r\n---\r\n\r\n# Mine\r\n');

  const init = drakom(['init', root], 'y\n');
  const sync = drakom(['sync', root]);

  assert.equal(init.status, 0, init.stdout + init.stderr);
  assert.equal(sync.status, 0, sync.stdout + sync.stderr);
  for (const relativePath of ['AGENTS.md', 'CLAUDE.md', '.worktreeinclude', '.claude/skills/mine/SKILL.md']) {
    assertOnlyCrlf(await read(root, relativePath), relativePath);
  }
  assert.ok((await read(root, 'AGENTS.md')).includes(toCrlf(MANAGED_BLOCK)));
  const check = drakom(['sync', root, '--check']);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test('an installation converted to CRLF by a checkout is up to date, with no conflict and no state rewrite', async (t) => {
  const root = await tempTarget(t);
  const init = drakom(['init', root, '--yes']);
  assert.equal(init.status, 0, init.stderr);
  await write(root, '.agents/skills/mine/SKILL.md', '---\nname: mine\ndescription: Mine\n---\n\n# Mine\n');
  assert.equal(drakom(['sync', root]).status, 0);
  await convertTreeToCrlf(root);
  const before = await snapshot(root);

  const check = drakom(['sync', root, '--check']);
  const sync = drakom(['sync', root]);

  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.doesNotMatch(check.stdout, /CONFLICT|UPDATE|CREATE|DELETE/);
  assert.equal(sync.status, 0, sync.stdout + sync.stderr);
  assert.deepEqual(await snapshot(root), before);
});

test('fingerprints that 0.5.0 recorded over CRLF bytes are re-recorded once, then every checkout is clean', async (t) => {
  const root = await tempTarget(t);
  const init = drakom(['init', root, '--yes']);
  assert.equal(init.status, 0, init.stderr);
  // What 0.5.0 recorded: an accepted CRLF edit, a kit file it found matching the CRLF payload of a
  // Windows checkout, and the mixed-ending mirror of a CRLF skill, all hashed as their exact bytes.
  const editedSkill = toCrlf('---\nname: drakom-ai-setup\ndescription: Edited locally\n---\n\n# Mine\n');
  await write(root, setupSkill, editedSkill);
  await write(root, setupMirror, mixedMirrorOf(editedSkill));
  const ruleAnatomy = '.agents/skills/drakom-ai-setup/references/rule-anatomy.md';
  const crlfAnatomy = toCrlf(await read(root, ruleAnatomy));
  await write(root, ruleAnatomy, crlfAnatomy);
  const state = JSON.parse(await read(root, statePath));
  const payloadSkill = await readFile(path.join(repositoryRoot, 'payload/v1/skills/drakom-ai-setup/SKILL.md'), 'utf8');
  state.managedFiles[setupSkill].fingerprint = fingerprint(toCrlf(payloadSkill));
  state.managedFiles[setupSkill].acceptedFingerprint = fingerprint(editedSkill);
  state.managedFiles[ruleAnatomy].fingerprint = fingerprint(crlfAnatomy);
  state.managedSkillMirrors[setupMirror].fingerprint = fingerprint(mixedMirrorOf(editedSkill));
  await write(root, 'AGENTS.md', toCrlf(await read(root, 'AGENTS.md')));
  state.managedBlocks['AGENTS.md#drakom-ai'].fingerprint = fingerprint(toCrlf(`${MANAGED_BLOCK}\n`));
  await write(root, statePath, `${JSON.stringify(state, null, 2)}\n`);

  const heal = drakom(['sync', root]);

  assert.equal(heal.status, 0, heal.stdout + heal.stderr);
  assert.doesNotMatch(heal.stdout, /CONFLICT/);
  assert.match(heal.stdout, /UPDATE\s+\.claude\/skills\/drakom-ai-setup\/SKILL\.md/);
  assertOnlyCrlf(await read(root, setupMirror), setupMirror);
  const healed = JSON.parse(await read(root, statePath));
  assert.equal(healed.managedFiles[setupSkill].acceptedFingerprint, lfFingerprint(editedSkill));
  assert.equal(healed.managedFiles[ruleAnatomy].fingerprint, lfFingerprint(crlfAnatomy));
  assert.equal(healed.managedSkillMirrors[setupMirror].fingerprint, lfFingerprint(mixedMirrorOf(editedSkill)));
  assert.equal(healed.managedBlocks['AGENTS.md#drakom-ai'].fingerprint, lfFingerprint(`${MANAGED_BLOCK}\n`));
  await assertCleanOnEveryCheckout(root);
});

test('legacy CRLF records migrate after an LF checkout while actual edits still conflict', async (t) => {
  const root = await tempTarget(t);
  assert.equal(drakom(['init', root, '--yes']).status, 0);
  const baseline = await read(root, setupSkill);
  const edit = '---\nname: drakom-ai-setup\ndescription: Accepted locally\n---\n\n# Mine\n';
  await write(root, setupSkill, edit);
  const state = JSON.parse(await read(root, statePath));
  state.managedFiles[setupSkill].fingerprint = fingerprint(toCrlf(baseline));
  state.managedFiles[setupSkill].acceptedFingerprint = fingerprint(toCrlf(edit));
  state.managedBlocks['AGENTS.md#drakom-ai'].fingerprint = fingerprint(toCrlf(`${MANAGED_BLOCK}\n`));
  await write(root, statePath, `${JSON.stringify(state, null, 2)}\n`);

  const heal = drakom(['sync', root]);

  assert.equal(heal.status, 0, heal.stdout + heal.stderr);
  assert.equal(await read(root, setupSkill), edit);
  const healed = JSON.parse(await read(root, statePath));
  assert.equal(healed.managedFiles[setupSkill].fingerprint, lfFingerprint(baseline));
  assert.equal(healed.managedFiles[setupSkill].acceptedFingerprint, lfFingerprint(edit));
  assert.equal(healed.managedBlocks['AGENTS.md#drakom-ai'].fingerprint, lfFingerprint(`${MANAGED_BLOCK}\n`));
  await assertCleanOnEveryCheckout(root);

  await write(root, setupSkill, `${edit}Edited again.\n`);
  const changed = drakom(['sync', root, '--check']);
  assert.equal(changed.status, 2, changed.stdout + changed.stderr);
  assert.match(changed.stdout, /CONFLICT.*edited again after its local edit was accepted/);
  assert.equal(await read(root, setupSkill), `${edit}Edited again.\n`);

  await write(root, setupSkill, edit);
  healed.managedFiles[setupSkill].fingerprint = fingerprint(toCrlf(`${baseline}A different kit baseline.\n`));
  await write(root, statePath, `${JSON.stringify(healed, null, 2)}\n`);
  const kitChanged = drakom(['sync', root, '--check']);
  assert.equal(kitChanged.status, 2, kitChanged.stdout + kitChanged.stderr);
  assert.match(kitChanged.stdout, /CONFLICT.*changed this file, which has an accepted local edit/);
});

test('a mixed-ending 0.5.0 mirror that a checkout already converted is re-recorded, not a conflict', async (t) => {
  const root = await tempTarget(t);
  const init = drakom(['init', root, '--yes']);
  assert.equal(init.status, 0, init.stderr);
  const skill = toCrlf('---\nname: mine\ndescription: Mine\n---\n\n# Mine\n');
  const mirror = '.claude/skills/mine/SKILL.md';
  await write(root, '.agents/skills/mine/SKILL.md', skill);
  await write(root, mirror, mixedMirrorOf(skill));
  const state = JSON.parse(await read(root, statePath));
  state.managedSkillMirrors[mirror] = { fingerprint: fingerprint(mixedMirrorOf(skill)) };
  await write(root, statePath, `${JSON.stringify(state, null, 2)}\n`);
  // The shared state is checked out on another machine, where the mirror's bytes are all LF.
  await convertTreeToLf(root);

  const check = drakom(['sync', root, '--check']);
  const heal = drakom(['sync', root]);

  assert.equal(check.status, 2, check.stdout + check.stderr);
  assert.doesNotMatch(check.stdout, /CONFLICT/);
  assert.equal(heal.status, 0, heal.stdout + heal.stderr);
  assert.match(heal.stdout, /UPDATE\s+\.drakom-ai\/state\.json/);
  assert.equal(JSON.parse(await read(root, statePath)).managedSkillMirrors[mirror].fingerprint, lfFingerprint(mixedMirrorOf(skill)));
  await assertCleanOnEveryCheckout(root);
});

test('an outdated managed block in a CRLF AGENTS.md is replaced with a CRLF block', async (t) => {
  const root = await tempTarget(t);
  const init = drakom(['init', root, '--yes']);
  assert.equal(init.status, 0, init.stderr);
  const oldBlock = '<!-- drakom-ai:start -->\nAn older routing block.\n<!-- drakom-ai:end -->\n';
  await write(root, 'AGENTS.md', toCrlf(`# Project\n\n${oldBlock}\nAfter the block.\n`));
  const state = JSON.parse(await read(root, statePath));
  state.managedBlocks['AGENTS.md#drakom-ai'].fingerprint = fingerprint(oldBlock);
  await write(root, statePath, `${JSON.stringify(state, null, 2)}\n`);

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 0, sync.stdout + sync.stderr);
  assert.match(sync.stdout, /UPDATE\s+AGENTS\.md/);
  const agents = await read(root, 'AGENTS.md');
  assertOnlyCrlf(agents, 'AGENTS.md');
  assert.equal(agents, toCrlf(`# Project\n\n${MANAGED_BLOCK}\n\nAfter the block.\n`));
});

test('a managed file the kit updates keeps its CRLF line endings', async (t) => {
  const root = await tempTarget(t);
  const init = drakom(['init', root, '--yes']);
  assert.equal(init.status, 0, init.stderr);
  // An earlier kit version's file, unedited, then converted to CRLF by a checkout.
  const olderKitFile = '---\nname: drakom-ai-setup\ndescription: An older kit version\n---\n\n# Setup\n';
  await write(root, setupSkill, toCrlf(olderKitFile));
  const state = JSON.parse(await read(root, statePath));
  state.managedFiles[setupSkill].fingerprint = fingerprint(olderKitFile);
  // The state file was converted to CRLF by the same checkout.
  await write(root, statePath, toCrlf(`${JSON.stringify(state, null, 2)}\n`));

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 0, sync.stdout + sync.stderr);
  assert.match(sync.stdout, /UPDATE\s+\.agents\/skills\/drakom-ai-setup\/SKILL\.md/);
  assert.match(sync.stdout, /UPDATE\s+\.drakom-ai\/state\.json/);
  assertOnlyCrlf(await read(root, setupSkill), setupSkill);
  assertOnlyCrlf(await read(root, statePath), statePath);
  const check = drakom(['sync', root, '--check']);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test('one stray CRLF line does not turn an LF file into CRLF', async (t) => {
  const root = await tempTarget(t);
  const init = drakom(['init', root, '--yes']);
  assert.equal(init.status, 0, init.stderr);
  const olderKitFile = '---\r\nname: drakom-ai-setup\ndescription: An older kit version\n---\n\n# Setup\n';
  await write(root, setupSkill, olderKitFile);
  const state = JSON.parse(await read(root, statePath));
  state.managedFiles[setupSkill].fingerprint = fingerprint(olderKitFile);
  await write(root, statePath, `${JSON.stringify(state, null, 2)}\n`);

  const sync = drakom(['sync', root]);

  assert.equal(sync.status, 0, sync.stdout + sync.stderr);
  assert.match(sync.stdout, /UPDATE\s+\.agents\/skills\/drakom-ai-setup\/SKILL\.md/);
  assert.doesNotMatch(await read(root, setupSkill), /\r/);
});
