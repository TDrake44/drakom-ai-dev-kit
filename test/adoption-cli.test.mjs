import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCliArgs } from '../dist/cli-arguments.js';
import { DRAKOM_DIR } from '../dist/constants.js';
import { inspectTarget } from '../dist/inspect-target.js';
import { buildInitPlan, MANAGED_BLOCK } from '../dist/operation-plan.js';
import { loadPackagePayload } from '../dist/package-payload.js';
import { renderPlan } from '../dist/render-plan.js';
import { runCli } from '../dist/run-cli.js';
import { compareVersions, loadState } from '../dist/state.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');
const ruleAnatomyTarget = '.agents/skills/drakom-ai-setup/references/rule-anatomy.md';
const ruleAnatomySource = 'skills/drakom-ai-setup/references/rule-anatomy.md';
const skillAuthorTarget = '.agents/skills/drakom-skill-author/SKILL.md';
const skillAuthorSource = 'skills/drakom-skill-author/SKILL.md';
const skillAuthorMirror = '.claude/skills/drakom-skill-author/SKILL.md';
const skillPatternsTarget = '.agents/skills/drakom-skill-author/references/skill-patterns.md';
const skillPatternsSource = 'skills/drakom-skill-author/references/skill-patterns.md';

test('publishes the strict TypeScript CLI from compiled dist output', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const sourceFiles = await readdir(path.join(repositoryRoot, 'src'));

  assert.equal(packageJson.bin['drakom-ai'], 'dist/cli.js');
  assert.equal(sourceFiles.some((file) => file.endsWith('.mjs')), false);
  assert.equal(sourceFiles.every((file) => file.endsWith('.ts')), true);
});

test('exports DRAKOM_DIR constant representing the project-specific AI context directory', () => {
  assert.equal(DRAKOM_DIR, '.drakom-ai');
});

test('inspectTarget treats a directory containing only .git/ as fresh', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drakom-adoption-'));
  await mkdir(path.join(root, '.git'));
  await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');

  const inventory = await inspectTarget(root);
  assert.equal(inventory.status, 'fresh');
});

test('inspectTarget still reads skills whose names match build-output directories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drakom-adoption-'));
  await mkdir(path.join(root, '.agents', 'skills', 'build'), { recursive: true });
  await writeFile(path.join(root, '.agents', 'skills', 'build', 'SKILL.md'), '---\nname: build\n---\n', 'utf8');

  const inventory = await inspectTarget(root);

  assert.ok(inventory.skillFiles.includes('.agents/skills/build/SKILL.md'));
});

test('inspectTarget lists heavy directories as a single entry without recursing into them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drakom-adoption-'));
  await mkdir(path.join(root, 'node_modules', 'some-pkg'), { recursive: true });
  await writeFile(path.join(root, 'node_modules', 'some-pkg', 'index.js'), '', 'utf8');
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist', 'out.js'), '', 'utf8');
  await mkdir(path.join(root, '.venv'));
  await writeFile(path.join(root, '.venv', 'pyvenv.cfg'), '', 'utf8');

  const inventory = await inspectTarget(root);
  assert.ok(inventory.pathSet.has('node_modules/'));
  assert.ok(inventory.pathSet.has('dist/'));
  assert.ok(inventory.pathSet.has('.venv/'));
  assert.equal(inventory.pathSet.has('node_modules/some-pkg/'), false);
  assert.equal(inventory.pathSet.has('dist/out.js'), false);
  assert.equal(inventory.pathSet.has('.venv/pyvenv.cfg'), false);
});

async function createFixture() {
  return mkdtemp(path.join(os.tmpdir(), 'drakom-adoption-'));
}

/** @param {string} root */
async function snapshot(root) {
  /** @type {Record<string, string>} */
  const result = {};

  /** @param {string} directory */
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath);
      if (entry.isDirectory()) {
        result[`${relativePath}/`] = 'directory';
        await visit(absolutePath);
      } else {
        result[relativePath] = await readFile(absolutePath, 'utf8');
      }
    }
  }

  await visit(root);
  return result;
}

test('parses the documented init and sync command surfaces', () => {
  assert.deepEqual(parseCliArgs(['init', 'project', '--dry-run', '--yes', '--skip-mcp']), {
    command: 'init',
    targetPath: 'project',
    dryRun: true,
    yes: true,
    skipMcp: true,
    withPlanAudit: false,
  });
  assert.deepEqual(parseCliArgs(['init', '--with-plan-audit']), {
    command: 'init',
    targetPath: '.',
    dryRun: false,
    yes: false,
    skipMcp: false,
    withPlanAudit: true,
  });
  assert.deepEqual(parseCliArgs(['sync', '--check']), {
    command: 'sync',
    targetPath: '.',
    dryRun: false,
    check: true,
  });
  assert.throws(() => parseCliArgs(['init', '--check']), /--check.*sync/);
  assert.throws(() => parseCliArgs(['sync', '--yes']), /--yes.*init/);
  assert.throws(() => parseCliArgs(['unknown']), /Expected "init" or "sync"/);
});

test('parses global and command-specific help without requiring a target path', () => {
  assert.deepEqual(parseCliArgs(['--help']), { command: 'help', topic: 'global' });
  assert.deepEqual(parseCliArgs(['-h']), { command: 'help', topic: 'global' });
  assert.deepEqual(parseCliArgs(['init', '--help']), { command: 'help', topic: 'init' });
  assert.deepEqual(parseCliArgs(['sync', '-h']), { command: 'help', topic: 'sync' });
  assert.deepEqual(parseCliArgs(['init', '.', '--help']), { command: 'help', topic: 'init' });
});

test('parses --version and -V as a standalone command', () => {
  assert.deepEqual(parseCliArgs(['--version']), { command: 'version' });
  assert.deepEqual(parseCliArgs(['-V']), { command: 'version' });
  assert.throws(() => parseCliArgs(['--version', '.']), /--version does not accept additional arguments/);
});

test('renders help successfully before inspecting targets or prompting', async () => {
  /** @type {string[]} */
  const stdout = [];
  /** @type {string[]} */
  const stderr = [];
  const result = await runCli(['init', '\0', '--help'], {
    stdout: { write: (content) => { stdout.push(content); return true; } },
    stderr: { write: (content) => { stderr.push(content); return true; } },
    confirm: async () => {
      throw new Error('help must not prompt');
    },
  });

  assert.equal(result, 0);
  assert.equal(stderr.join(''), '');
  assert.match(stdout.join(''), /Usage: drakom-ai init \[path\]/);
  assert.match(stdout.join(''), /--skip-mcp/);
});

test('the compiled executable prints global help and exits successfully', () => {
  const result = spawnSync(process.execPath, [cliPath, '--help'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: drakom-ai <command>/);
  assert.match(result.stdout, /init/);
  assert.match(result.stdout, /sync/);
  assert.match(result.stdout, /-V, --version/);
  assert.equal(result.stderr, '');
});

test('the compiled executable prints the kit version, not the version of the project in the working directory', async () => {
  const kitPackage = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const project = await createFixture();
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'consumer-app', version: '9.8.7' }), 'utf8');
  const before = await snapshot(project);

  for (const flag of ['--version', '-V']) {
    const result = spawnSync(process.execPath, [cliPath, flag], { cwd: project, encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${kitPackage.version}\n`);
    assert.equal(result.stderr, '');
  }
  assert.deepEqual(await snapshot(project), before);
});

test('--version prints without inspecting targets or prompting', async () => {
  /** @type {string[]} */
  const stdout = [];
  const result = await runCli(['--version'], {
    stdout: { write: (content) => { stdout.push(content); return true; } },
    stderr: { write: () => { throw new Error('--version must not write to stderr'); } },
    confirm: async () => {
      throw new Error('--version must not prompt');
    },
    selectPlanAudit: async () => {
      throw new Error('--version must not prompt');
    },
  });

  assert.equal(result, 0);
  assert.match(stdout.join(''), /^\d+\.\d+\.\d+\S*\n$/);
});

/**
 * Payload manifest shape that kit-copy fixtures may alter. `defaults` is `unknown` so tests can
 * write malformed tables that the kit must reject.
 * @typedef {{ schemaVersion: number, kitVersion: string, files: Record<string, string>, defaults?: unknown }} FixtureManifest
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
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(kitRoot, 'node_modules'), 'dir');
  const payloadRoot = path.join(kitRoot, 'payload', 'v1');
  const manifestPath = path.join(payloadRoot, 'payload.json');
  /** @type {FixtureManifest} */
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await mutate(manifest, payloadRoot);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path.join(kitRoot, 'dist', 'cli.js');
}

/**
 * Copy the compiled kit with a payload that declares a different kitVersion.
 * @returns {Promise<string>} path to the copied cli.js
 */
async function createMismatchedKit() {
  return createKitCopy((manifest) => {
    manifest.kitVersion = '0.0.1';
  });
}

const exampleSkillTarget = '.agents/skills/drakom-example-default/SKILL.md';
const exampleReferenceTarget = '.agents/skills/drakom-example-default/references/example.md';
const exampleSkillContent = '---\nname: drakom-example-default\ndescription: Synthetic default skill\n---\n\n# Example\n';
const exampleReferenceContent = '# Example reference\n';

/**
 * Copy the compiled kit with a synthetic default skill and reference registered under `defaults`.
 * @param {string} addedIn
 * @returns {Promise<string>} path to the copied cli.js
 */
async function createKitWithDefaults(addedIn) {
  return createKitCopy(async (manifest, payloadRoot) => {
    const skillDir = path.join(payloadRoot, 'skills', 'drakom-example-default');
    await mkdir(path.join(skillDir, 'references'), { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), exampleSkillContent, 'utf8');
    await writeFile(path.join(skillDir, 'references', 'example.md'), exampleReferenceContent, 'utf8');
    manifest.files.exampleSkill = 'skills/drakom-example-default/SKILL.md';
    manifest.files.exampleReference = 'skills/drakom-example-default/references/example.md';
    manifest.defaults = {
      exampleSkill: { target: exampleSkillTarget, addedIn },
      exampleReference: { target: exampleReferenceTarget, addedIn },
    };
  });
}

/**
 * Initialize a target with the current kit, then rewrite its state kitVersion.
 * @param {string} kitVersion
 */
async function createInstalledFixture(kitVersion) {
  const root = await createFixture();
  const init = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.kitVersion = kitVersion;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return root;
}

test('a payload whose kitVersion differs from the package version fails before planning in every mode', async () => {
  const mismatchedCli = await createMismatchedKit();
  const freshTarget = await createFixture();
  const initializedTarget = await createFixture();
  const setup = spawnSync(process.execPath, [cliPath, 'init', initializedTarget, '--yes'], { encoding: 'utf8' });
  assert.equal(setup.status, 0, setup.stderr);

  const cases = [
    { target: freshTarget, args: ['init', freshTarget, '--yes'] },
    { target: freshTarget, args: ['init', freshTarget, '--dry-run'] },
    { target: initializedTarget, args: ['sync', initializedTarget] },
    { target: initializedTarget, args: ['sync', initializedTarget, '--dry-run'] },
    { target: initializedTarget, args: ['sync', initializedTarget, '--check'] },
  ];
  for (const { target, args } of cases) {
    const before = await snapshot(target);

    const result = spawnSync(process.execPath, [mismatchedCli, ...args], { encoding: 'utf8', input: 'y\n' });

    assert.equal(result.status, 1, `${args.join(' ')}: ${result.stdout}`);
    assert.equal(result.stdout, '', `${args.join(' ')} must not render a plan`);
    assert.match(result.stderr, /payload kitVersion 0\.0\.1 does not match package version/i);
    assert.match(result.stderr, /reinstall/i);
    assert.deepEqual(await snapshot(target), before, `${args.join(' ')} must not mutate the target`);
  }
});

test('inventories existing AI context and MCP targets', async () => {
  const root = await createFixture();
  await mkdir(path.join(root, 'packages', 'api'), { recursive: true });
  await mkdir(path.join(root, '.agents', 'skills', 'custom'), { recursive: true });
  await mkdir(path.join(root, '.vscode'), { recursive: true });
  await writeFile(path.join(root, 'AGENTS.md'), '# Existing\n', 'utf8');
  await writeFile(path.join(root, 'packages', 'api', 'CLAUDE.md'), '# Nested\n', 'utf8');
  await writeFile(path.join(root, '.agents', 'skills', 'custom', 'SKILL.md'), '# Custom\n', 'utf8');
  await writeFile(path.join(root, '.vscode', 'mcp.json'), '{"servers":{}}\n', 'utf8');

  const inventory = await inspectTarget(root);

  assert.equal(inventory.status, 'existing');
  assert.deepEqual(inventory.contextFiles, ['AGENTS.md', 'packages/api/CLAUDE.md']);
  assert.deepEqual(inventory.skillFiles, ['.agents/skills/custom/SKILL.md']);
  assert.deepEqual(inventory.mcpFiles, ['.vscode/mcp.json']);
  assert.equal(inventory.state, null);
});

test('loads valid state and rejects malformed or future state with an actionable path', async () => {
  const root = await createFixture();
  const stateDirectory = path.join(root, DRAKOM_DIR);
  await mkdir(stateDirectory);
  await writeFile(
    path.join(stateDirectory, 'state.json'),
    JSON.stringify({
      schemaVersion: 1,
      kitVersion: '0.1.0',
      features: { mcp: true, skillMirrors: true },
      managedFiles: {},
      managedMcpServers: {},
    }),
    'utf8',
  );

  assert.equal((await loadState(root))?.schemaVersion, 1);

  await writeFile(path.join(stateDirectory, 'state.json'), '{', 'utf8');
  await assert.rejects(loadState(root), new RegExp(`${DRAKOM_DIR}/state\\.json.*valid JSON`));

  await writeFile(
    path.join(stateDirectory, 'state.json'),
    JSON.stringify({ schemaVersion: 2 }),
    'utf8',
  );
  await assert.rejects(loadState(root), /schemaVersion 2.*newer.*upgrade/i);
});

test('builds and renders deterministic fresh-project plans', async () => {
  const root = await createFixture();
  const inventory = await inspectTarget(root);
  const payload = await loadPackagePayload();

  const firstPlan = buildInitPlan(inventory, { skipMcp: false }, payload);
  const secondPlan = buildInitPlan(inventory, { skipMcp: false }, payload);

  assert.deepEqual(firstPlan, secondPlan);
  assert.equal(renderPlan(firstPlan), renderPlan(secondPlan));
  assert.deepEqual(
    firstPlan.operations.filter((operation) => operation.action === 'create').map(({ path: value }) => value),
    [
      `${DRAKOM_DIR}/.gitignore`,
      `${DRAKOM_DIR}/mcp-servers.yaml`,
      `${DRAKOM_DIR}/rules/README.md`,
      `${DRAKOM_DIR}/specs/README.md`,
      '.agents/skills/drakom-ai-setup/SKILL.md',
      '.agents/skills/drakom-ai-setup/references/assessment-plan-template.md',
      'AGENTS.md',
      'CLAUDE.md',
      '.worktreeinclude',
      ruleAnatomyTarget,
      skillAuthorTarget,
      skillPatternsTarget,
      `${DRAKOM_DIR}/state.json`,
    ],
  );
  assert.match(renderPlan(firstPlan), /CREATE .*drakom-ai-setup\/SKILL\.md/);
  assert.match(renderPlan(firstPlan), /PRESERVE .*existing files/i);
  assert.equal(firstPlan.operations.some(({ path: value }) => value === '.agents/skills/drakom-plan-audit/SKILL.md'), false);
});

test('opt-in plan audit is included and recorded as kit-managed', async () => {
  const root = await createFixture();
  const inventory = await inspectTarget(root);
  const payload = await loadPackagePayload();

  assert.match(payload.files.planAuditSkill, /Audit or clean up/);
  const plan = buildInitPlan(inventory, { skipMcp: false, withPlanAudit: true }, payload);
  const skillOperation = plan.operations.find(({ path: value }) => value === '.agents/skills/drakom-plan-audit/SKILL.md');
  const stateOperation = plan.operations.find(({ path: value }) => value === `${DRAKOM_DIR}/state.json`);

  assert.equal(skillOperation?.action, 'create');
  assert.match(skillOperation?.content ?? '', /uncertain plans still matter before deleting/i);
  assert.match(stateOperation?.content ?? '', /drakom-plan-audit\/SKILL\.md/);
});

test('init --dry-run is deterministic and makes zero filesystem changes', async () => {
  const root = await createFixture();
  await writeFile(path.join(root, 'README.md'), '# Keep me\n', 'utf8');
  const before = await snapshot(root);

  const first = spawnSync(process.execPath, [cliPath, 'init', root, '--dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  const second = spawnSync(process.execPath, [cliPath, 'init', root, '--dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(await snapshot(root), before);
});

test('init --dry-run rejects missing targets without creating them', () => {
  const target = path.join(os.tmpdir(), `drakom-missing-${process.pid}-${Date.now()}`);
  const result = spawnSync(process.execPath, [cliPath, 'init', target, '--dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Target path does not exist/);
});

test('packages a complete approval-gated setup workflow and assessment template', async () => {
  const payload = await loadPackagePayload();
  const skill = payload.files.setupSkill;
  const assessment = payload.files.assessmentTemplate;
  const sourceSetupSkill = await readFile(
    path.join(repositoryRoot, '.agents', 'skills', 'drakom-ai-setup', 'SKILL.md'),
    'utf8',
  );
  const sourcePlanAuditSkill = await readFile(path.join(repositoryRoot, '.agents', 'skills', 'drakom-plan-audit', 'SKILL.md'), 'utf8');

  assert.equal(skill, sourceSetupSkill);
  assert.equal(payload.files.planAuditSkill, sourcePlanAuditSkill);
  assert.match(skill, /languages, manifests, package managers/i);
  assert.match(skill, /keep.*refine.*add.*omit/is);
  assert.match(skill, /stable policy.*rule/is);
  assert.match(skill, /recurring multi-step workflow.*skill/is);
  assert.match(skill, /explicit approval/i);
  assert.match(skill, new RegExp(`${DRAKOM_DIR}/plans/`));
  assert.match(skill, /drakom-ai sync/);
  assert.match(skill, /verify.*path.*command.*reference/is);
  assert.match(skill, /Do not assume.*custom rules.*skills/is);
  assert.match(skill, new RegExp(`create.*${DRAKOM_DIR}/rules/`, 'is'));
  assert.match(skill, /AGENTS\.md.*Standards Index/is);
  assert.match(skill, /remove or revise.*stale.*route/is);
  assert.match(skill, /not.*globally.*load/is);
  assert.doesNotMatch(skill, /legacy|\.ai\//i);
  assert.match(payload.manifest.files.planAuditSkill, /skills\/drakom-plan-audit\/SKILL\.md$/);
  assert.match(assessment, /## Keep/);
  assert.match(assessment, /## Refine/);
  assert.match(assessment, /## Add/);
  assert.match(assessment, /## Omit/);
  assert.match(assessment, /## Approval Gate/);
  assert.doesNotMatch(assessment, /legacy|\.ai\//i);
});

test('the setup skill and template require a per-source assessment matrix', async () => {
  const payload = await loadPackagePayload();

  for (const [name, text] of [
    ['setupSkill', payload.files.setupSkill],
    ['assessmentTemplate', payload.files.assessmentTemplate],
  ]) {
    assert.match(text, /source path and evidence/i, name);
    assert.match(text, /kit-managed.*generated.*project-owned.*unmanaged.*unknown/is, name);
    assert.match(text, /decision and rationale/i, name);
    assert.match(text, /destination or action/i, name);
    assert.match(text, /keep in place/i, name);
    assert.match(text, /dependencies.*routes.*scripts.*companion files/is, name);
    assert.match(text, /approval status/i, name);
    assert.match(text, /verification/i, name);
    assert.match(text, /Omit never means delete/i, name);
    assert.doesNotMatch(text, /legacy|\.ai\//i, name);
  }
  assert.match(payload.files.setupSkill, new RegExp(`${DRAKOM_DIR}/plans/.*${DRAKOM_DIR}/specs/.*gitignore`, 'is'));
});

test('packages a rule anatomy reference that the setup skill routes to by repository-root path', async () => {
  const payload = await loadPackagePayload();
  const skill = payload.files.setupSkill;
  const anatomy = payload.files.ruleAnatomy;
  const installedAnatomy = await readFile(path.join(repositoryRoot, ruleAnatomyTarget), 'utf8');

  assert.equal(anatomy, installedAnatomy);
  const referencedPaths = [...skill.matchAll(/`\.agents\/(skills\/drakom-ai-setup\/references\/[^`]+)`/g)].map(
    ([, rel]) => rel,
  );
  assert.ok(referencedPaths.includes(ruleAnatomySource), 'setup skill must reference rule-anatomy.md');
  for (const rel of referencedPaths) {
    assert.ok(Object.values(payload.manifest.files).includes(rel), `${rel} is not packaged`);
  }
  const addSection = skill.slice(skill.indexOf('**Add:**'), skill.indexOf('**Omit:**'));
  assert.match(addSection, new RegExp(ruleAnatomyTarget.replaceAll('.', '\\.')));
  assert.match(skill, new RegExp(`Create each approved rule[^\\n]*${ruleAnatomyTarget.replaceAll('.', '\\.')}`, 'i'));

  for (const section of ['Scope', 'Required Patterns', 'Prohibited Patterns', 'Verification']) {
    assert.match(anatomy, new RegExp(`\\*\\*${section}\\*\\*`), section);
  }
  assert.match(anatomy, /150.200 lines/);
  assert.match(anatomy, /real.*in this repository/i);
  assert.match(anatomy, /reason/i);
  assert.match(anatomy, /formatters, linters, types, or tests/i);
  for (const ruleType of ['Coding', 'Testing', 'Documentation', 'Domain risk', 'Security', 'API contracts']) {
    const heading = new RegExp(`^### ${ruleType}\\n([\\s\\S]*?)(?=^##|$(?![\\s\\S]))`, 'm');
    const block = anatomy.match(heading)?.[1] ?? '';
    assert.match(block, /Justified when/i, ruleType);
    assert.match(block, /Skip when/i, ruleType);
  }
  assert.match(anatomy, /## Worked Example/);
  assert.doesNotMatch(anatomy, /legacy|\.ai\//i);
});

test('fresh interactive init installs the rule anatomy reference and records it as managed', async () => {
  const root = await createFixture();

  const result = await runCli(['init', root], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    selectPlanAudit: async () => false,
    confirm: async () => true,
  });

  assert.equal(result, 0);
  const payload = await loadPackagePayload();
  assert.equal(await readFile(path.join(root, ruleAnatomyTarget), 'utf8'), payload.files.ruleAnatomy);
  const state = JSON.parse(await readFile(path.join(root, DRAKOM_DIR, 'state.json'), 'utf8'));
  assert.equal(state.managedFiles[ruleAnatomyTarget].source, ruleAnatomySource);
});

test('a 0.3.0 install receives the rule anatomy reference through one sync', async () => {
  const root = await createInstalledFixture('0.3.0');
  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  await rm(path.join(root, ruleAnatomyTarget));
  const legacyState = JSON.parse(await readFile(statePath, 'utf8'));
  delete legacyState.managedFiles[ruleAnatomyTarget];
  await writeFile(statePath, `${JSON.stringify(legacyState, null, 2)}\n`, 'utf8');

  const check = spawnSync(process.execPath, [cliPath, 'sync', root, '--check'], { encoding: 'utf8' });
  assert.notEqual(check.status, 0, check.stdout);
  assert.match(check.stdout, /CREATE.*references\/rule-anatomy\.md/);

  const sync = spawnSync(process.execPath, [cliPath, 'sync', root], { encoding: 'utf8' });
  assert.equal(sync.status, 0, sync.stderr);

  const payload = await loadPackagePayload();
  assert.equal(await readFile(path.join(root, ruleAnatomyTarget), 'utf8'), payload.files.ruleAnatomy);
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.managedFiles[ruleAnatomyTarget].source, ruleAnatomySource);
  const cleanCheck = spawnSync(process.execPath, [cliPath, 'sync', root, '--check'], { encoding: 'utf8' });
  assert.equal(cleanCheck.status, 0, cleanCheck.stdout);
});

test('packages an approval-gated skill authoring skill that routes to its patterns by repository-root path', async () => {
  const payload = await loadPackagePayload();
  const skill = payload.files.skillAuthorSkill;
  const patterns = payload.files.skillPatterns;

  assert.equal(skill, await readFile(path.join(repositoryRoot, skillAuthorTarget), 'utf8'));
  assert.equal(patterns, await readFile(path.join(repositoryRoot, skillPatternsTarget), 'utf8'));
  assert.match(skill, /^---\nname: drakom-skill-author\ndescription: [^\n]+\n---\n/);

  const referencedPaths = [...skill.matchAll(/`\.agents\/(skills\/drakom-skill-author\/references\/[^`]+)`/g)].map(
    ([, rel]) => rel,
  );
  assert.ok(referencedPaths.includes(skillPatternsSource), 'skill author must reference skill-patterns.md');
  for (const rel of referencedPaths) {
    assert.ok(Object.values(payload.manifest.files).includes(rel), `${rel} is not packaged`);
    await readFile(path.join(repositoryRoot, '.agents', rel), 'utf8');
  }

  for (const mode of ['Find', 'Write', 'Check', 'Refine or Retire']) {
    assert.match(skill, new RegExp(`^## ${mode}$`, 'm'), mode);
  }
  assert.match(skill, /^## Approval Gate$/m);
  assert.match(skill, /explicit approval before creating or changing any project skill/i);
  assert.match(skill, /at least two real occurrences.*explicit (user )?request/is);
  for (const source of ['git history', 'pull request history', 'CI configuration', 'package scripts', 'CONTRIBUTING', 'plan']) {
    assert.match(skill, new RegExp(source, 'i'), source);
  }
  assert.match(skill, /never use the `drakom-` prefix/i);
  assert.match(skill, /what it does and when to use it/i);
  assert.match(skill, /route.*rules.*instead of copying/is);
  assert.match(skill, /`\.agents\/skills\/<name>\/SKILL\.md`/);
  assert.match(skill, /AGENTS\.md.*skill table/is);
  assert.match(skill, /drakom-ai sync/);
  assert.match(skill, /propose remov/i);
  assert.doesNotMatch(skill, /legacy|\.ai\/|moneycl/i);

  for (const archetype of ['Plan', 'Task', 'Review', 'Release', 'Docs sync', 'Migration step', 'Debugging']) {
    const heading = new RegExp(`^### ${archetype}\\n([\\s\\S]*?)(?=^##|$(?![\\s\\S]))`, 'm');
    const block = patterns.match(heading)?.[1] ?? '';
    assert.match(block, /Justified when/i, archetype);
    assert.match(block, /Skip when/i, archetype);
    assert.match(block, /Sections/i, archetype);
  }
  assert.match(patterns, /^## Worked Example/m);
  assert.doesNotMatch(patterns, /legacy|\.ai\/|moneycl/i);
});

test('the setup skill hands skill additions to drakom-skill-author and never installs a fixed suite', async () => {
  const skill = (await loadPackagePayload()).files.setupSkill;

  const addSection = skill.slice(skill.indexOf('**Add:**'), skill.indexOf('**Omit:**'));
  assert.match(addSection, /proposed skill.*Write and Check procedure/is);
  assert.match(addSection, new RegExp(skillAuthorTarget.replaceAll('.', '\\.')));
  assert.match(skill, /Create each approved skill[^\n]*drakom-skill-author[^\n]*Write and Check/i);
  assert.match(skill, /never install a fixed skill suite/i);
  assert.doesNotMatch(skill, /legacy|\.ai\//i);
});

test('the managed AGENTS.md block names the skill authoring skill', () => {
  assert.match(MANAGED_BLOCK, /`\$drakom-skill-author`/);
  assert.match(MANAGED_BLOCK, /`\$drakom-ai-setup`/);
});

for (const mode of ['interactive', '--yes']) {
  test(`fresh ${mode} init installs the skill authoring skill and the next sync mirrors it`, async () => {
    const root = await createFixture();

    if (mode === 'interactive') {
      const result = await runCli(['init', root], {
        stdout: { write: () => true },
        stderr: { write: () => true },
        selectPlanAudit: async () => false,
        confirm: async () => true,
      });
      assert.equal(result, 0);
    } else {
      const init = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { encoding: 'utf8' });
      assert.equal(init.status, 0, init.stderr);
    }

    const payload = await loadPackagePayload();
    assert.equal(await readFile(path.join(root, skillAuthorTarget), 'utf8'), payload.files.skillAuthorSkill);
    assert.equal(await readFile(path.join(root, skillPatternsTarget), 'utf8'), payload.files.skillPatterns);
    const state = JSON.parse(await readFile(path.join(root, DRAKOM_DIR, 'state.json'), 'utf8'));
    assert.equal(state.managedFiles[skillAuthorTarget].source, skillAuthorSource);
    assert.equal(state.managedFiles[skillPatternsTarget].source, skillPatternsSource);

    const sync = spawnSync(process.execPath, [cliPath, 'sync', root], { encoding: 'utf8' });
    assert.equal(sync.status, 0, sync.stderr);
    const mirror = await readFile(path.join(root, skillAuthorMirror), 'utf8');
    assert.match(mirror, /GENERATED MIRROR/);
    assert.match(mirror, /^---\nname: drakom-skill-author\n/);
    await assert.rejects(readFile(path.join(root, '.claude', 'skills', 'drakom-skill-author', 'references', 'skill-patterns.md')));
  });
}

test('a 0.3.0 install receives the skill authoring files, mirror, managed block, and state in one sync', async () => {
  const root = await createInstalledFixture('0.3.0');
  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const legacyBlock = `<!-- drakom-ai:start -->
## Drakom AI Development Context

Project-specific AI context is stored under \`${DRAKOM_DIR}/\`.
Use \`$drakom-ai-setup\` to assess or revise the project's agent configuration.
<!-- drakom-ai:end -->
`;
  await rm(path.join(root, '.agents', 'skills', 'drakom-skill-author'), { recursive: true });
  await writeFile(path.join(root, 'AGENTS.md'), `# Project\n\n${legacyBlock}`, 'utf8');
  const legacyState = JSON.parse(await readFile(statePath, 'utf8'));
  delete legacyState.managedFiles[skillAuthorTarget];
  delete legacyState.managedFiles[skillPatternsTarget];
  const crypto = await import('node:crypto');
  legacyState.managedBlocks['AGENTS.md#drakom-ai'] = {
    fingerprint: `sha256:${crypto.createHash('sha256').update(legacyBlock).digest('hex')}`,
  };
  await writeFile(statePath, `${JSON.stringify(legacyState, null, 2)}\n`, 'utf8');

  const check = spawnSync(process.execPath, [cliPath, 'sync', root, '--check'], { encoding: 'utf8' });
  assert.notEqual(check.status, 0, check.stdout);
  assert.match(check.stdout, /CREATE.*drakom-skill-author\/SKILL\.md/);

  const sync = spawnSync(process.execPath, [cliPath, 'sync', root], { encoding: 'utf8' });
  assert.equal(sync.status, 0, sync.stderr);

  const payload = await loadPackagePayload();
  assert.equal(await readFile(path.join(root, skillAuthorTarget), 'utf8'), payload.files.skillAuthorSkill);
  assert.equal(await readFile(path.join(root, skillPatternsTarget), 'utf8'), payload.files.skillPatterns);
  assert.match(await readFile(path.join(root, skillAuthorMirror), 'utf8'), /GENERATED MIRROR/);
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), `# Project\n\n${MANAGED_BLOCK}\n`);
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.managedFiles[skillAuthorTarget].source, skillAuthorSource);
  assert.equal(state.managedFiles[skillPatternsTarget].source, skillPatternsSource);
  assert.ok(state.managedSkillMirrors[skillAuthorMirror]);
  const cleanCheck = spawnSync(process.execPath, [cliPath, 'sync', root, '--check'], { encoding: 'utf8' });
  assert.equal(cleanCheck.status, 0, cleanCheck.stdout);
});

test('init output lists detected context paths in deterministic order without contents', async () => {
  const root = await createFixture();
  await mkdir(path.join(root, 'packages', 'api'), { recursive: true });
  await mkdir(path.join(root, '.github'), { recursive: true });
  await mkdir(path.join(root, '.cursor', 'rules'), { recursive: true });
  await writeFile(path.join(root, 'AGENTS.md'), 'SECRET-AGENTS-BODY\n', 'utf8');
  await writeFile(path.join(root, 'packages', 'api', 'CLAUDE.md'), 'SECRET-NESTED-BODY\n', 'utf8');
  await writeFile(path.join(root, '.github', 'copilot-instructions.md'), 'SECRET-COPILOT-BODY\n', 'utf8');
  await writeFile(path.join(root, '.cursor', 'rules', 'style.mdc'), 'SECRET-CURSOR-BODY\n', 'utf8');

  const first = spawnSync(process.execPath, [cliPath, 'init', root, '--dry-run'], { encoding: 'utf8' });
  const second = spawnSync(process.execPath, [cliPath, 'init', root, '--dry-run'], { encoding: 'utf8' });

  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.match(
    first.stdout,
    /Detected context sources:\n {2}\.cursor\/rules\/style\.mdc\n {2}\.github\/copilot-instructions\.md\n {2}AGENTS\.md\n {2}packages\/api\/CLAUDE\.md\n\n/,
  );
  assert.ok(first.stdout.indexOf('Detected context sources:') < first.stdout.indexOf('MKDIR'));
  assert.doesNotMatch(first.stdout, /SECRET-/);
});

test('init output reports when no context sources are detected', async () => {
  const root = await createFixture();

  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--dry-run'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Detected context sources: none\n/);
});

test('init --yes creates fresh scaffolding, records state last, and is idempotent', async () => {
  const root = await createFixture();

  const first = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Ask your coding agent to use \$drakom-ai-setup/);
  assert.equal(await readFile(path.join(root, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.equal(
    await readFile(path.join(root, '.worktreeinclude'), 'utf8'),
    `${DRAKOM_DIR}/plans/*\n${DRAKOM_DIR}/assets/*\n`,
  );
  assert.equal(await readFile(path.join(root, DRAKOM_DIR, 'mcp-servers.yaml'), 'utf8'), 'servers: {}\n');
  assert.match(
    await readFile(path.join(root, DRAKOM_DIR, 'rules', 'README.md'), 'utf8'),
    /project-specific policies.*\$drakom-ai-setup/is,
  );
  assert.match(
    await readFile(path.join(root, DRAKOM_DIR, 'specs', 'README.md'), 'utf8'),
    /git-tracked.*specifications/i,
  );
  await readdir(path.join(root, DRAKOM_DIR, 'rules'));
  await readdir(path.join(root, DRAKOM_DIR, 'plans'));
  await readdir(path.join(root, DRAKOM_DIR, 'specs'));
  await readdir(path.join(root, DRAKOM_DIR, 'assets'));
  const state = JSON.parse(await readFile(path.join(root, DRAKOM_DIR, 'state.json'), 'utf8'));
  assert.equal(state.schemaVersion, 1);
  assert.deepEqual(Object.keys(state.managedFiles), [
    `${DRAKOM_DIR}/rules/README.md`,
    `${DRAKOM_DIR}/specs/README.md`,
    '.agents/skills/drakom-ai-setup/SKILL.md',
    '.agents/skills/drakom-ai-setup/references/assessment-plan-template.md',
    ruleAnatomyTarget,
    skillAuthorTarget,
    skillPatternsTarget,
  ]);
  assert.equal(state.managedFiles[ruleAnatomyTarget].source, ruleAnatomySource);
  assert.equal(state.managedFiles[skillAuthorTarget].source, skillAuthorSource);
  assert.equal(state.managedFiles[skillPatternsTarget].source, skillPatternsSource);
  assert.equal(
    await readFile(path.join(root, ruleAnatomyTarget), 'utf8'),
    (await loadPackagePayload()).files.ruleAnatomy,
  );
  const afterFirst = await snapshot(root);
  assert.equal((await inspectTarget(root)).status, 'initialized');

  const second = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(await snapshot(root), afterFirst);
});

test('init asks before installing the optional drakom-plan-audit skill', async () => {
  const root = await createFixture();
  /** @type {string[]} */
  const stdout = [];
  let selected = 0;
  const result = await runCli(['init', root], {
    stdout: { write: (content) => { stdout.push(content); return true; } },
    stderr: { write: () => true },
    selectPlanAudit: async () => { selected += 1; return true; },
    confirm: async () => true,
  });

  assert.equal(result, 0);
  assert.equal(selected, 1);
  assert.match(stdout.join(''), /\.agents\/skills\/drakom-plan-audit\/SKILL\.md/);
  assert.match(
    await readFile(path.join(root, '.agents', 'skills', 'drakom-plan-audit', 'SKILL.md'), 'utf8'),
    /classify\s+each plan/i,
  );
});

test('init --yes --with-plan-audit installs the optional skill without prompting for selection', async () => {
  const root = await createFixture();
  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--yes', '--with-plan-audit'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\.agents\/skills\/drakom-plan-audit\/SKILL\.md/);
  assert.match(
    await readFile(path.join(root, '.agents', 'skills', 'drakom-plan-audit', 'SKILL.md'), 'utf8'),
    /classify\s+each plan/i,
  );
});

test('init --yes --with-plan-audit adds the managed skill to an initialized project', async () => {
  const root = await createFixture();
  const initial = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(initial.status, 0, initial.stderr);

  const optIn = spawnSync(process.execPath, [cliPath, 'init', root, '--yes', '--with-plan-audit'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(optIn.status, 0, optIn.stderr);
  assert.match(optIn.stdout, /CREATE\s+\.agents\/skills\/drakom-plan-audit\/SKILL\.md/);
  assert.match(optIn.stdout, /Ask your coding agent to use \$drakom-plan-audit/);
  assert.match(
    await readFile(path.join(root, '.agents', 'skills', 'drakom-plan-audit', 'SKILL.md'), 'utf8'),
    /classify\s+each plan/i,
  );
  const state = JSON.parse(await readFile(path.join(root, DRAKOM_DIR, 'state.json'), 'utf8'));
  assert.ok(state.managedFiles['.agents/skills/drakom-plan-audit/SKILL.md']);
});

test('initialized drakom-plan-audit opt-in refuses to take ownership of an unmanaged skill', async () => {
  const root = await createFixture();
  const initial = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(initial.status, 0, initial.stderr);
  const skillDirectory = path.join(root, '.agents', 'skills', 'drakom-plan-audit');
  const skillPath = path.join(skillDirectory, 'SKILL.md');
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(skillPath, '# Project-owned plan audit\n', 'utf8');

  const optIn = spawnSync(process.execPath, [cliPath, 'init', root, '--yes', '--with-plan-audit'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(optIn.status, 0);
  assert.match(optIn.stdout, /CONFLICT \.agents\/skills\/drakom-plan-audit\/SKILL\.md/);
  assert.equal(await readFile(skillPath, 'utf8'), '# Project-owned plan audit\n');
  const state = JSON.parse(await readFile(path.join(root, DRAKOM_DIR, 'state.json'), 'utf8'));
  assert.equal(state.managedFiles['.agents/skills/drakom-plan-audit/SKILL.md'], undefined);
});

test('initialized drakom-plan-audit opt-in rejects state created by a newer kit version', async () => {
  const root = await createFixture();
  const initial = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(initial.status, 0, initial.stderr);
  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.kitVersion = '999.0.0';
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const optIn = spawnSync(process.execPath, [cliPath, 'init', root, '--yes', '--with-plan-audit'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(optIn.status, 0);
  assert.match(optIn.stderr, /newer than CLI kitVersion.*upgrade/i);
  assert.equal(await readFile(path.join(root, '.agents', 'skills', 'drakom-plan-audit', 'SKILL.md'), 'utf8').catch(() => null), null);
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).kitVersion, '999.0.0');
});

test('init --skip-mcp omits the registry and records the disabled feature', async () => {
  const root = await createFixture();

  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--yes', '--skip-mcp'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const installed = await snapshot(root);
  assert.equal(installed[`${DRAKOM_DIR}/mcp-servers.yaml`], undefined);
  const state = JSON.parse(installed[`${DRAKOM_DIR}/state.json`]);
  assert.equal(state.features.mcp, false);
});

test('init --yes refuses structured merges and makes zero changes', async () => {
  const root = await createFixture();
  await writeFile(path.join(root, 'AGENTS.md'), '# Existing policy\n', 'utf8');
  const before = await snapshot(root);

  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--yes.*cannot approve.*structured merges.*interactive/i);
  assert.deepEqual(await snapshot(root), before);
});

test('interactive init preserves and extends existing entry points exactly as previewed', async () => {
  const root = await createFixture();
  await writeFile(path.join(root, 'AGENTS.md'), '# Existing policy\n', 'utf8');
  await writeFile(path.join(root, 'CLAUDE.md'), '# Claude-only note\n', 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'init', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: 'y\n',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), /^# Existing policy\n\n<!-- drakom-ai:start -->/);
  assert.equal(
    await readFile(path.join(root, 'CLAUDE.md'), 'utf8'),
    '# Claude-only note\n\n@AGENTS.md\n',
  );
});

test('init appends local AI context to existing .worktreeinclude', async () => {
  const root = await createFixture();
  await writeFile(path.join(root, '.worktreeinclude'), '.env\n.data/*\n', 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'init', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: 'y\n',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(path.join(root, '.worktreeinclude'), 'utf8'),
    `.env\n.data/*\n${DRAKOM_DIR}/plans/*\n${DRAKOM_DIR}/assets/*\n`,
  );
});

test('init preserves existing .worktreeinclude when local AI context is already present', async () => {
  const root = await createFixture();
  const existing = `.env\n${DRAKOM_DIR}/plans/*\n${DRAKOM_DIR}/assets/*\n`;
  await writeFile(path.join(root, '.worktreeinclude'), existing, 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PRESERVE \.worktreeinclude/);
});

test('init appends only missing local AI context entry to .worktreeinclude', async () => {
  const root = await createFixture();
  await writeFile(path.join(root, '.worktreeinclude'), `.env\n${DRAKOM_DIR}/plans/*\n`, 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'init', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: 'y\n',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(path.join(root, '.worktreeinclude'), 'utf8'),
    `.env\n${DRAKOM_DIR}/plans/*\n${DRAKOM_DIR}/assets/*\n`,
  );
});

test('init reports conflict when .worktreeinclude is a directory', async () => {
  const root = await createFixture();
  await mkdir(path.join(root, '.worktreeinclude'), { recursive: true });

  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /CONFLICT \.worktreeinclude/);
});

test('init on an initialized repository scaffolds missing .worktreeinclude', async () => {
  const root = await createFixture();
  const initResult = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(initResult.status, 0);

  const { unlink } = await import('node:fs/promises');
  await unlink(path.join(root, '.worktreeinclude'));

  const adoptResult = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(adoptResult.status, 0);
  assert.match(adoptResult.stdout, /CREATE\s+\.worktreeinclude/);
  assert.equal(
    await readFile(path.join(root, '.worktreeinclude'), 'utf8'),
    `${DRAKOM_DIR}/plans/*\n${DRAKOM_DIR}/assets/*\n`,
  );

  const thirdResult = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(thirdResult.status, 0);
  assert.match(thirdResult.stdout, /already initialized; no changes made/);
});

test('preflight conflicts prevent every initialization mutation', async () => {
  const root = await createFixture();
  const collision = path.join(root, '.agents', 'skills', 'drakom-ai-setup');
  await mkdir(collision, { recursive: true });
  await writeFile(path.join(collision, 'SKILL.md'), '# Project-owned\n', 'utf8');
  const before = await snapshot(root);

  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /CONFLICT.*drakom-ai-setup\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('the shipped payload manifest declares a valid defaults table', async () => {
  const payload = await loadPackagePayload();

  assert.deepEqual(payload.manifest.defaults, {
    ruleAnatomy: { target: ruleAnatomyTarget, addedIn: '0.4.0' },
    skillAuthorSkill: { target: skillAuthorTarget, addedIn: '0.4.0' },
    skillPatterns: { target: skillPatternsTarget, addedIn: '0.4.0' },
  });
  assert.equal(payload.manifest.files.ruleAnatomy, ruleAnatomySource);
  assert.equal(payload.manifest.files.skillAuthorSkill, skillAuthorSource);
  assert.equal(payload.manifest.files.skillPatterns, skillPatternsSource);
});

test('payload defaults are validated before any planning', async () => {
  const target = await createInstalledFixture('0.3.0');
  const cases = [
    { defaults: { missingKey: { target: '.agents/skills/x/SKILL.md', addedIn: '0.4.0' } }, error: /missingKey.*not.*files/i },
    { defaults: { setupSkill: { target: '../escape/SKILL.md', addedIn: '0.4.0' } }, error: /setupSkill.*target/i },
    { defaults: { setupSkill: { target: '/abs/SKILL.md', addedIn: '0.4.0' } }, error: /setupSkill.*target/i },
    { defaults: { setupSkill: { target: '.agents/skills/x/SKILL.md', addedIn: '0.4' } }, error: /setupSkill.*addedIn/i },
    { defaults: { setupSkill: { target: './.agents/skills/x/SKILL.md', addedIn: '0.4.0' } }, error: /setupSkill.*target/i },
    { defaults: { setupSkill: { target: '.agents//skills/x/SKILL.md', addedIn: '0.4.0' } }, error: /setupSkill.*target/i },
    { defaults: { setupSkill: { target: '.agents/./skills/x/SKILL.md', addedIn: '0.4.0' } }, error: /setupSkill.*target/i },
    { defaults: { setupSkill: { target: '.agents\\skills\\x\\SKILL.md', addedIn: '0.4.0' } }, error: /setupSkill.*target/i },
    { defaults: { setupSkill: { target: '.agents/skills/x/', addedIn: '0.4.0' } }, error: /setupSkill.*target/i },
    { defaults: [], error: /defaults/i },
  ];
  for (const { defaults, error } of cases) {
    const kitCli = await createKitCopy((manifest) => {
      manifest.defaults = defaults;
    });
    const before = await snapshot(target);

    const result = spawnSync(process.execPath, [kitCli, 'sync', target, '--check'], { encoding: 'utf8' });

    assert.equal(result.status, 1, JSON.stringify(defaults));
    assert.match(result.stderr, error);
    assert.deepEqual(await snapshot(target), before);
  }
});

test('sync installs default files added after the recorded kit version, with mirrors and state', async () => {
  const kitCli = await createKitWithDefaults('0.4.0');
  const root = await createInstalledFixture('0.3.0');
  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const pristine = await snapshot(root);

  const check = spawnSync(process.execPath, [kitCli, 'sync', root, '--check'], { encoding: 'utf8' });
  assert.notEqual(check.status, 0, check.stdout);
  assert.match(check.stdout, /CREATE.*drakom-example-default\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), pristine);

  const dryRun = spawnSync(process.execPath, [kitCli, 'sync', root, '--dry-run'], { encoding: 'utf8' });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /CREATE.*\.agents\/skills\/drakom-example-default\/SKILL\.md/);
  assert.match(dryRun.stdout, /CREATE.*drakom-example-default\/references\/example\.md/);
  assert.match(dryRun.stdout, /CREATE.*\.claude\/skills\/drakom-example-default\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), pristine);

  const sync = spawnSync(process.execPath, [kitCli, 'sync', root], { encoding: 'utf8' });
  assert.equal(sync.status, 0, sync.stderr);

  assert.equal(await readFile(path.join(root, exampleSkillTarget), 'utf8'), exampleSkillContent);
  assert.equal(await readFile(path.join(root, exampleReferenceTarget), 'utf8'), exampleReferenceContent);
  const mirror = await readFile(path.join(root, '.claude', 'skills', 'drakom-example-default', 'SKILL.md'), 'utf8');
  assert.match(mirror, /GENERATED MIRROR/);
  assert.match(mirror, /# Example/);
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.managedFiles[exampleSkillTarget].source, 'skills/drakom-example-default/SKILL.md');
  assert.equal(
    state.managedFiles[exampleReferenceTarget].source,
    'skills/drakom-example-default/references/example.md',
  );
  assert.ok(state.managedSkillMirrors['.claude/skills/drakom-example-default/SKILL.md']);

  const cleanCheck = spawnSync(process.execPath, [kitCli, 'sync', root, '--check'], { encoding: 'utf8' });
  assert.equal(cleanCheck.status, 0, cleanCheck.stdout);
});

test('a default installed by sync stays in sync on the next run', async () => {
  const target = `${DRAKOM_DIR}/rules/example.md`;
  const kitCli = await createKitCopy(async (manifest, payloadRoot) => {
    await writeFile(path.join(payloadRoot, 'templates', 'example-rule.md'), '# Example rule\n', 'utf8');
    manifest.files.exampleRule = 'templates/example-rule.md';
    manifest.defaults = { exampleRule: { target, addedIn: '0.4.0' } };
  });
  const root = await createInstalledFixture('0.3.0');
  const install = spawnSync(process.execPath, [kitCli, 'sync', root], { encoding: 'utf8' });
  assert.equal(install.status, 0, install.stderr);
  const afterInstall = await snapshot(root);

  const second = spawnSync(process.execPath, [kitCli, 'sync', root], { encoding: 'utf8' });

  assert.equal(second.status, 0, second.stdout);
  assert.doesNotMatch(second.stdout, /CONFLICT/);
  assert.equal(afterInstall[target], '# Example rule\n');
  assert.deepEqual(await snapshot(root), afterInstall);
});

test('sync refuses to take ownership of an unmanaged file at a new default path', async () => {
  const kitCli = await createKitWithDefaults('0.4.0');
  const root = await createInstalledFixture('0.3.0');
  await mkdir(path.join(root, '.agents', 'skills', 'drakom-example-default', 'references'), { recursive: true });
  await writeFile(path.join(root, exampleReferenceTarget), '# Hand-written\n', 'utf8');
  const before = await snapshot(root);

  const sync = spawnSync(process.execPath, [kitCli, 'sync', root], { encoding: 'utf8' });

  assert.notEqual(sync.status, 0);
  assert.match(sync.stdout, /CONFLICT.*drakom-example-default\/references\/example\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync does not re-offer a removed default once state reaches its addedIn version', async () => {
  const kitCli = await createKitWithDefaults('0.3.0');
  const root = await createInstalledFixture('0.2.0');
  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const install = spawnSync(process.execPath, [kitCli, 'sync', root], { encoding: 'utf8' });
  assert.equal(install.status, 0, install.stderr);
  assert.equal(await readFile(path.join(root, exampleSkillTarget), 'utf8'), exampleSkillContent);

  await rm(path.join(root, '.agents', 'skills', 'drakom-example-default'), { recursive: true });
  await rm(path.join(root, '.claude', 'skills', 'drakom-example-default'), { recursive: true });
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.ok(compareVersions(state.kitVersion, '0.3.0') >= 0, `state ${state.kitVersion} should reach addedIn 0.3.0`);
  delete state.managedFiles[exampleSkillTarget];
  delete state.managedFiles[exampleReferenceTarget];
  delete state.managedSkillMirrors['.claude/skills/drakom-example-default/SKILL.md'];
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  const before = await snapshot(root);

  const check = spawnSync(process.execPath, [kitCli, 'sync', root, '--check'], { encoding: 'utf8' });
  const sync = spawnSync(process.execPath, [kitCli, 'sync', root], { encoding: 'utf8' });

  assert.equal(check.status, 0, check.stdout);
  assert.equal(sync.status, 0, sync.stderr);
  assert.deepEqual(await snapshot(root), before);
});

test('init installs registered defaults on fresh projects and records them as managed', async () => {
  const kitCli = await createKitWithDefaults('0.4.0');
  const root = await createFixture();

  const init = spawnSync(process.execPath, [kitCli, 'init', root, '--yes'], { encoding: 'utf8' });

  assert.equal(init.status, 0, init.stderr);
  assert.equal(await readFile(path.join(root, exampleSkillTarget), 'utf8'), exampleSkillContent);
  assert.equal(await readFile(path.join(root, exampleReferenceTarget), 'utf8'), exampleReferenceContent);
  const state = JSON.parse(await readFile(path.join(root, DRAKOM_DIR, 'state.json'), 'utf8'));
  assert.ok(state.managedFiles[exampleSkillTarget]);
  assert.ok(state.managedFiles[exampleReferenceTarget]);
});

test('sync rejects uninitialized target directories with a clear message', async () => {
  const root = await createFixture();
  const result = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not an initialized Drakom installation.*run init/i);
});

test('sync --dry-run previews updates and makes zero filesystem changes', async () => {
  const root = await createFixture();
  const initResult = spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(initResult.status, 0);

  const customSkillDir = path.join(root, '.agents', 'skills', 'custom');
  await mkdir(customSkillDir, { recursive: true });
  await writeFile(
    path.join(customSkillDir, 'SKILL.md'),
    '---\nname: custom\ndescription: Custom skill\n---\n\n# Custom\n',
    'utf8',
  );

  const before = await snapshot(root);
  const dryRunResult = spawnSync(process.execPath, [cliPath, 'sync', root, '--dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(dryRunResult.status, 0, dryRunResult.stderr);
  assert.match(dryRunResult.stdout, /Drakom AI sync plan/);
  assert.match(dryRunResult.stdout, /CREATE.*\.claude\/skills\/custom\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync --check reports drift and exits nonzero when sync is needed, and exits 0 when clean', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const customSkillDir = path.join(root, '.agents', 'skills', 'custom');
  await mkdir(customSkillDir, { recursive: true });
  await writeFile(
    path.join(customSkillDir, 'SKILL.md'),
    '---\nname: custom\ndescription: Custom skill\n---\n\n# Custom\n',
    'utf8',
  );

  const before = await snapshot(root);
  const checkResult = spawnSync(process.execPath, [cliPath, 'sync', root, '--check'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.notEqual(checkResult.status, 0);
  assert.deepEqual(await snapshot(root), before);

  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(syncResult.status, 0, syncResult.stderr);

  const cleanCheck = spawnSync(process.execPath, [cliPath, 'sync', root, '--check'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(cleanCheck.status, 0, cleanCheck.stderr);
});

test('sync updates unchanged managed files and records state last with updated fingerprints', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const setupSkillPath = path.join(root, '.agents', 'skills', 'drakom-ai-setup', 'SKILL.md');

  const oldContent = '# Old Setup Skill Content\n';
  await writeFile(setupSkillPath, oldContent, 'utf8');
  const crypto = await import('node:crypto');
  const oldFp = `sha256:${crypto.createHash('sha256').update(oldContent).digest('hex')}`;
  state.kitVersion = '0.0.9';
  state.managedFiles['.agents/skills/drakom-ai-setup/SKILL.md'].fingerprint = oldFp;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(syncResult.status, 0, syncResult.stderr);

  const payload = await loadPackagePayload();
  assert.equal(await readFile(setupSkillPath, 'utf8'), payload.files.setupSkill);

  const updatedState = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(updatedState.kitVersion, payload.manifest.kitVersion);
  assert.notEqual(updatedState.managedFiles['.agents/skills/drakom-ai-setup/SKILL.md'].fingerprint, oldFp);

  const snapshotBefore = await snapshot(root);
  const secondSync = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(secondSync.status, 0, secondSync.stderr);
  assert.deepEqual(await snapshot(root), snapshotBefore);
});

test('sync stops all writes when a managed file was locally modified', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const setupSkillPath = path.join(root, '.agents', 'skills', 'drakom-ai-setup', 'SKILL.md');
  await writeFile(setupSkillPath, '# Hand edited setup skill\n', 'utf8');

  const before = await snapshot(root);
  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*drakom-ai-setup\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync stops all writes when a managed block in AGENTS.md was locally modified', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const agentsPath = path.join(root, 'AGENTS.md');
  const agentsContent = await readFile(agentsPath, 'utf8');
  const modifiedAgents = agentsContent.replace('Drakom AI Development Context', 'Modified Context Heading');
  await writeFile(agentsPath, modifiedAgents, 'utf8');

  const before = await snapshot(root);
  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*AGENTS\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync handles Claude skill mirrors, preserves Claude-only skills, and removes stale mirrors', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(
    path.join(canonicalDir, 'SKILL.md'),
    '---\nname: tester\n---\n\n# Tester Skill\n',
    'utf8',
  );

  const claudeOnlyDir = path.join(root, '.claude', 'skills', 'claude-special');
  await mkdir(claudeOnlyDir, { recursive: true });
  await writeFile(
    path.join(claudeOnlyDir, 'SKILL.md'),
    '---\nname: claude-special\n---\n\n# Claude Only Hand Authored\n',
    'utf8',
  );

  const staleDir = path.join(root, '.claude', 'skills', 'old-skill');
  await mkdir(staleDir, { recursive: true });
  const notice = '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->';
  const staleContent = `${notice}\n\n# Old Skill\n`;
  await writeFile(
    path.join(staleDir, 'SKILL.md'),
    staleContent,
    'utf8',
  );
  await writeFile(
    path.join(staleDir, 'extra.txt'),
    'Extra supporting file\n',
    'utf8',
  );

  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const crypto = await import('node:crypto');
  state.managedSkillMirrors = {
    '.claude/skills/old-skill/SKILL.md': {
      fingerprint: `sha256:${crypto.createHash('sha256').update(staleContent).digest('hex')}`,
    },
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(syncResult.status, 0, syncResult.stderr);

  const testerMirror = await readFile(path.join(root, '.claude', 'skills', 'tester', 'SKILL.md'), 'utf8');
  assert.match(testerMirror, /GENERATED MIRROR/);

  const claudeOnly = await readFile(path.join(claudeOnlyDir, 'SKILL.md'), 'utf8');
  assert.match(claudeOnly, /# Claude Only Hand Authored/);

  const oldFiles = await readdir(staleDir);
  assert.deepEqual(oldFiles, ['extra.txt']);
});

test('sync stops all writes on collision between canonical skill and hand-authored Claude skill', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(
    path.join(canonicalDir, 'SKILL.md'),
    '---\nname: tester\n---\n\n# Tester Skill\n',
    'utf8',
  );

  const claudeDir = path.join(root, '.claude', 'skills', 'tester');
  await mkdir(claudeDir, { recursive: true });
  await writeFile(
    path.join(claudeDir, 'SKILL.md'),
    '---\nname: tester\n---\n\n# Hand Authored Tester\n',
    'utf8',
  );

  const before = await snapshot(root);
  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*\.claude\/skills\/tester/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync rejects projects created with a newer kitVersion than the CLI', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.kitVersion = '99.0.0';
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stderr, /newer than CLI kitVersion.*upgrade/i);
});

test('sync stops all writes when a generated Claude skill mirror was locally modified', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(
    path.join(canonicalDir, 'SKILL.md'),
    '---\nname: tester\n---\n\n# Tester Skill\n',
    'utf8',
  );

  const sync1 = spawnSync(process.execPath, [cliPath, 'sync', root], { cwd: repositoryRoot });
  assert.equal(sync1.status, 0);

  const mirrorPath = path.join(root, '.claude', 'skills', 'tester', 'SKILL.md');
  const mirrorContent = await readFile(mirrorPath, 'utf8');
  await writeFile(mirrorPath, `${mirrorContent}\n# Local edit\n`, 'utf8');

  const before = await snapshot(root);
  const sync2 = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(sync2.status, 0);
  assert.match(sync2.stdout, /CONFLICT.*\.claude\/skills\/tester\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync stops all writes when a stale Claude skill mirror was locally modified', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(
    path.join(canonicalDir, 'SKILL.md'),
    '---\nname: tester\n---\n\n# Tester Skill\n',
    'utf8',
  );

  const sync1 = spawnSync(process.execPath, [cliPath, 'sync', root], { cwd: repositoryRoot });
  assert.equal(sync1.status, 0);

  const rm = await import('node:fs/promises');
  await rm.unlink(path.join(canonicalDir, 'SKILL.md'));
  await rm.rmdir(canonicalDir);

  const mirrorPath = path.join(root, '.claude', 'skills', 'tester', 'SKILL.md');
  const mirrorContent = await readFile(mirrorPath, 'utf8');
  await writeFile(mirrorPath, `${mirrorContent}\n# Local modification to stale mirror\n`, 'utf8');

  const before = await snapshot(root);
  const sync2 = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(sync2.status, 0);
  assert.match(sync2.stdout, /CONFLICT.*\.claude\/skills\/tester\/SKILL\.md/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync rejects operations that escape target root through a symlinked directory', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const outsideDir = await createFixture();
  const canaryFile = path.join(outsideDir, 'canary.txt');
  await writeFile(canaryFile, 'CANARY\n', 'utf8');

  const symlink = (await import('node:fs/promises')).symlink;
  await symlink(outsideDir, path.join(root, '.claude'), 'dir');

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(path.join(canonicalDir, 'SKILL.md'), '# Tester\n', 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /escapes the target through a symlink/i);
  assert.equal(await readFile(canaryFile, 'utf8'), 'CANARY\n');
  const outsideFiles = await readdir(outsideDir);
  assert.deepEqual(outsideFiles, ['canary.txt']);
});

test('sync reports conflict and refuses state update when managed file source is missing in payload', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const crypto = await import('node:crypto');
  const obsoleteContent = '# Obsolete\n';
  const obsoleteFp = `sha256:${crypto.createHash('sha256').update(obsoleteContent).digest('hex')}`;
  const obsoletePath = '.agents/skills/obsolete/SKILL.md';
  await mkdir(path.join(root, '.agents', 'skills', 'obsolete'), { recursive: true });
  await writeFile(path.join(root, obsoletePath), obsoleteContent, 'utf8');
  state.managedFiles[obsoletePath] = {
    source: 'skills/obsolete/SKILL.md',
    fingerprint: obsoleteFp,
  };
  state.kitVersion = '0.0.9';
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const before = await snapshot(root);
  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*obsolete.*missing from this kit version.*upgrade notes/i);
  assert.deepEqual(await snapshot(root), before);
  const stateAfter = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(stateAfter.kitVersion, '0.0.9');
});

test('sync --dry-run --check renders preview and exits nonzero when drift exists', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(path.join(canonicalDir, 'SKILL.md'), '# Tester\n', 'utf8');

  const before = await snapshot(root);
  const result = spawnSync(process.execPath, [cliPath, 'sync', root, '--dry-run', '--check'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Drakom AI sync plan/);
  assert.match(result.stderr, /Drift detected/);
  assert.deepEqual(await snapshot(root), before);
});

test('sync upgrades unchanged managed AGENTS.md block while preserving surrounding content', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const agentsPath = path.join(root, 'AGENTS.md');
  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));

  const oldBlock = `<!-- drakom-ai:start -->
## Drakom AI Development Context

Old instruction body.
<!-- drakom-ai:end -->
`;
  const crypto = await import('node:crypto');
  const oldBlockFp = `sha256:${crypto.createHash('sha256').update(oldBlock).digest('hex')}`;
  state.managedBlocks['AGENTS.md#drakom-ai'] = { fingerprint: oldBlockFp };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const agentsContent = `# User Policy Header\n\n${oldBlock}\n## User Policy Footer\n`;
  await writeFile(agentsPath, agentsContent, 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const updatedAgents = await readFile(agentsPath, 'utf8');
  assert.match(updatedAgents, /^# User Policy Header/);
  assert.match(updatedAgents, /## User Policy Footer\n$/);
  assert.match(updatedAgents, /Use `\$drakom-ai-setup` to assess or revise/);
  assert.doesNotMatch(updatedAgents, /Old instruction body/);

  const updatedState = JSON.parse(await readFile(statePath, 'utf8'));
  assert.notEqual(updatedState.managedBlocks['AGENTS.md#drakom-ai'].fingerprint, oldBlockFp);
});

test('sync reports conflict and makes zero writes when an unrecorded Claude skill mirror has local edits', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(
    path.join(canonicalDir, 'SKILL.md'),
    '---\nname: tester\n---\n\n# Canonical Tester\n',
    'utf8',
  );

  const notice = '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->';
  const mirrorDir = path.join(root, '.claude', 'skills', 'tester');
  await mkdir(mirrorDir, { recursive: true });
  await writeFile(
    path.join(mirrorDir, 'SKILL.md'),
    `---\nname: tester\n---\n${notice}\n\n# Locally edited unrecorded mirror\n`,
    'utf8',
  );

  const before = await snapshot(root);
  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*\.claude\/skills\/tester\/SKILL\.md.*unrecorded and does not match expected content/i);
  assert.deepEqual(await snapshot(root), before);
});

test('sync cleanly adopts an unrecorded Claude skill mirror when its content matches expected canonical mirror content', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const canonicalDir = path.join(root, '.agents', 'skills', 'tester');
  await mkdir(canonicalDir, { recursive: true });
  const canonicalContent = '---\nname: tester\n---\n\n# Canonical Tester\n';
  await writeFile(path.join(canonicalDir, 'SKILL.md'), canonicalContent, 'utf8');

  const notice = '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->';
  const mirrorDir = path.join(root, '.claude', 'skills', 'tester');
  await mkdir(mirrorDir, { recursive: true });
  const frontmatter = canonicalContent.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  assert(frontmatter);
  const expectedMirrorContent = `${frontmatter}\n${notice}\n\n${canonicalContent.slice(frontmatter.length)}`;
  await writeFile(path.join(mirrorDir, 'SKILL.md'), expectedMirrorContent, 'utf8');

  const stateBefore = JSON.parse(await readFile(path.join(root, DRAKOM_DIR, 'state.json'), 'utf8'));
  assert.equal(stateBefore.managedSkillMirrors?.['.claude/skills/tester/SKILL.md'], undefined);

  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(syncResult.status, 0, syncResult.stderr);
  const stateAfter = JSON.parse(await readFile(path.join(root, DRAKOM_DIR, 'state.json'), 'utf8'));
  const crypto = await import('node:crypto');
  const expectedFp = `sha256:${crypto.createHash('sha256').update(expectedMirrorContent).digest('hex')}`;
  assert.equal(stateAfter.managedSkillMirrors?.['.claude/skills/tester/SKILL.md']?.fingerprint, expectedFp);
});

test('sync reports conflict and makes zero writes when a stale Claude skill mirror is unrecorded', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const notice = '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->';
  const staleDir = path.join(root, '.claude', 'skills', 'stale-skill');
  await mkdir(staleDir, { recursive: true });
  await writeFile(
    path.join(staleDir, 'SKILL.md'),
    `${notice}\n\n# Stale Skill\n`,
    'utf8',
  );

  const before = await snapshot(root);
  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stdout, /CONFLICT.*\.claude\/skills\/stale-skill\/SKILL\.md.*is unrecorded/i);
  assert.deepEqual(await snapshot(root), before);
});

test('an unmanaged .agents/skills/plan-audit/ no longer blocks opting in to drakom-plan-audit', async () => {
  const root = await createFixture();
  await mkdir(path.join(root, '.agents', 'skills', 'plan-audit'), { recursive: true });
  await writeFile(
    path.join(root, '.agents', 'skills', 'plan-audit', 'SKILL.md'),
    '# Project-owned plan audit, unrelated to the kit\n',
    'utf8',
  );

  const result = spawnSync(process.execPath, [cliPath, 'init', root, '--yes', '--with-plan-audit'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CREATE\s+\.agents\/skills\/drakom-plan-audit\/SKILL\.md/);
  assert.equal(
    await readFile(path.join(root, '.agents', 'skills', 'plan-audit', 'SKILL.md'), 'utf8'),
    '# Project-owned plan audit, unrelated to the kit\n',
  );
  assert.match(
    await readFile(path.join(root, '.agents', 'skills', 'drakom-plan-audit', 'SKILL.md'), 'utf8'),
    /classify\s+each plan/i,
  );
});

test('sync rejects invalid SemVer kitVersion in state', async () => {
  const root = await createFixture();
  spawnSync(process.execPath, [cliPath, 'init', root, '--yes'], { cwd: repositoryRoot });

  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.kitVersion = '1.0';
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const syncResult = spawnSync(process.execPath, [cliPath, 'sync', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  assert.notEqual(syncResult.status, 0);
  assert.match(syncResult.stderr, /invalid SemVer kitVersion/i);
});

test('SemVer compareVersions adheres to SemVer 2.0.0 precedence', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.1.0', '1.0.9'), 1);
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);

  // Normal vs pre-release
  assert.equal(compareVersions('1.0.0', '1.0.0-beta'), 1);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);

  // Pre-release precedence ordering
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta'), -1);
  assert.equal(compareVersions('1.0.0-alpha.beta', '1.0.0-beta'), -1);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0-beta.2'), -1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.11'), -1);
  assert.equal(compareVersions('1.0.0-beta.11', '1.0.0-rc.1'), -1);

  // Build metadata is ignored in precedence
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0+build.2'), 0);
  assert.equal(compareVersions('1.0.0-alpha+001', '1.0.0-alpha'), 0);

  // Large numeric identifiers exceeding Number.MAX_SAFE_INTEGER
  assert.equal(compareVersions('9007199254740993.0.0', '9007199254740992.0.0'), 1);
  assert.equal(compareVersions('9007199254740992.0.0', '9007199254740993.0.0'), -1);
  assert.equal(compareVersions('1.9007199254740993.0', '1.9007199254740992.0'), 1);
  assert.equal(compareVersions('1.0.9007199254740993', '1.0.9007199254740992'), 1);
  assert.equal(compareVersions('1.0.0-9007199254740993', '1.0.0-9007199254740992'), 1);
  assert.equal(compareVersions('1.0.0-9007199254740992', '1.0.0-9007199254740993'), -1);

  // Invalid SemVer strings throw
  assert.throws(() => compareVersions('1.0', '1.0.0'), /Invalid SemVer/);
  assert.throws(() => compareVersions('1.0.0', '1.0.0-01'), /Invalid SemVer/);
  assert.throws(() => compareVersions('v1.0.0', '1.0.0'), /Invalid SemVer/);
  assert.throws(() => compareVersions('1.0.0.0', '1.0.0'), /Invalid SemVer/);
});
