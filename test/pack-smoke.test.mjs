import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DRAKOM_DIR } from '../dist/constants.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFLINE_REGISTRY = 'http://127.0.0.1:9';

/** @param {string} content */
function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * Resolve package root dynamically by traversing up from entry point.
 * @param {string} specifier
 * @param {string} [fromPath]
 */
function findPackageRoot(specifier, fromPath = import.meta.url) {
  const req = createRequire(fromPath);
  let current = path.dirname(req.resolve(specifier));
  while (current !== path.dirname(current)) {
    try {
      req(path.join(current, 'package.json'));
      return current;
    } catch {
      current = path.dirname(current);
    }
  }
  throw new Error(`Cannot find package root for ${specifier}`);
}

/**
 * Stage and create a clean npm-compatible tarball without invoking package-manager prepack scripts.
 * @param {string} sourceDir
 * @param {string} destTarball
 */
function packDirToTarball(sourceDir, destTarball) {
  const stage = mkdtempSync(path.join(os.tmpdir(), 'drakom-tar-stage-'));
  try {
    const pkgDir = path.join(stage, 'package');
    mkdirSync(pkgDir, { recursive: true });
    cpSync(sourceDir, pkgDir, {
      recursive: true,
      filter: (src) => !path.relative(sourceDir, src).startsWith('node_modules'),
    });
    const res = spawnSync('tar', ['-czf', destTarball, '-C', stage, 'package'], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `tar -czf failed: ${res.stderr}`);
    return destTarball;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/**
 * Shared test fixture context created once for the smoke suite.
 */
class SmokeHarness {
  /** @type {string} */
  packDir = '';
  /** @type {string} */
  kitTarball = '';
  /** @type {string} */
  argparseTarball = '';
  /** @type {string} */
  jsyamlTarball = '';
  /** @type {string} */
  smoltomlTarball = '';
  /** @type {string} */
  hookPath = '';
  /** @type {Record<string, unknown>} */
  packInfo = {};
  /** @type {string} */
  unpackedDir = '';
  /** @type {string} */
  pnpmCacheDir = '';
  /** @type {string} */
  pnpmStoreDir = '';
  /** @type {string} */
  pnpmHomeDir = '';
  /** @type {string} */
  npmCacheDir = '';

  async init() {
    this.packDir = await mkdtemp(path.join(os.tmpdir(), 'drakom-pack-'));
    this.pnpmCacheDir = path.join(this.packDir, 'pnpm-cache');
    this.pnpmStoreDir = path.join(this.packDir, 'pnpm-store');
    this.pnpmHomeDir = path.join(this.packDir, 'pnpm-home');
    this.npmCacheDir = path.join(this.packDir, 'npm-cache');

    await mkdir(this.pnpmCacheDir, { recursive: true });
    await mkdir(this.pnpmStoreDir, { recursive: true });
    await mkdir(this.pnpmHomeDir, { recursive: true });
    await mkdir(this.npmCacheDir, { recursive: true });

    // 1. Pack the Drakom AI Dev Kit using pnpm pack --json
    const packRes = spawnSync('pnpm', ['pack', '--json', '--pack-destination', this.packDir], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    assert.equal(packRes.status, 0, `pnpm pack failed: ${packRes.stderr}`);

    // Parse structured JSON from pack stdout
    const jsonMatch = packRes.stdout.match(/\{[\s\S]*"filename":[\s\S]*\}/u);
    assert.ok(jsonMatch, `Could not parse JSON from pnpm pack output: ${packRes.stdout}`);
    this.packInfo = JSON.parse(jsonMatch[0]);
    this.kitTarball = String(this.packInfo.filename);
    assert.ok(this.kitTarball, 'Structured pnpm pack output missing filename');

    // 2. Prepare local runtime dependency tarballs for hermetic offline installation
    const jsyamlRoot = findPackageRoot('js-yaml');
    const smoltomlRoot = findPackageRoot('smol-toml');
    const argparseRoot = findPackageRoot('argparse', path.join(jsyamlRoot, 'index.js'));

    this.argparseTarball = packDirToTarball(argparseRoot, path.join(this.packDir, 'argparse-2.0.1.tgz'));
    this.jsyamlTarball = packDirToTarball(jsyamlRoot, path.join(this.packDir, 'js-yaml-4.1.0.tgz'));
    this.smoltomlTarball = packDirToTarball(smoltomlRoot, path.join(this.packDir, 'smol-toml-1.8.0.tgz'));

    // Create pnpm resolution hook redirecting runtime dependencies to local tarballs
    this.hookPath = path.join(this.packDir, 'pnpm-hook.cjs');
    await writeFile(
      this.hookPath,
      `module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.dependencies) {
        if (pkg.dependencies['argparse']) pkg.dependencies['argparse'] = 'file:${this.argparseTarball}';
        if (pkg.dependencies['js-yaml']) pkg.dependencies['js-yaml'] = 'file:${this.jsyamlTarball}';
        if (pkg.dependencies['smol-toml']) pkg.dependencies['smol-toml'] = 'file:${this.smoltomlTarball}';
      }
      return pkg;
    }
  }
};`,
      'utf8',
    );

    // 3. Extract the tarball to an isolated unpack directory
    this.unpackedDir = await mkdtemp(path.join(os.tmpdir(), 'drakom-unpack-'));
    const unpackRes = spawnSync('tar', ['-xzf', this.kitTarball, '-C', this.unpackedDir], {
      encoding: 'utf8',
    });
    assert.equal(unpackRes.status, 0, `tar -xzf failed: ${unpackRes.stderr}`);
  }

  pnpmEnv() {
    return {
      ...process.env,
      npm_config_offline: 'true',
      npm_config_registry: OFFLINE_REGISTRY,
      npm_config_cache_dir: this.pnpmCacheDir,
      npm_config_store_dir: this.pnpmStoreDir,
      npm_config_cache: this.npmCacheDir,
      XDG_CACHE_HOME: this.pnpmCacheDir,
      PNPM_HOME: this.pnpmHomeDir,
    };
  }

  pnpmConfigArgs() {
    return [
      `--config.cache-dir=${this.pnpmCacheDir}`,
      `--config.store-dir=${this.pnpmStoreDir}`,
      `--config.pnpmfile=${this.hookPath}`,
    ];
  }

  async cleanup() {
    if (this.packDir) await rm(this.packDir, { recursive: true, force: true });
    if (this.unpackedDir) await rm(this.unpackedDir, { recursive: true, force: true });
  }

  /**
   * Set up an isolated consumer project configured for hermetic pnpm testing.
   */
  async createPnpmConsumer() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'drakom-consumer-pnpm-'));
    const pkg = {
      name: 'consumer-pnpm',
      private: true,
    };
    await writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
    await writeFile(
      path.join(root, '.npmrc'),
      `cache-dir=${this.pnpmCacheDir}\nstore-dir=${this.pnpmStoreDir}\npnpmfile=${this.hookPath}\noffline=true\nregistry=${OFFLINE_REGISTRY}\n`,
      'utf8',
    );
    return root;
  }
}

/** @type {SmokeHarness} */
let harness;

test.before(async () => {
  harness = new SmokeHarness();
  await harness.init();
});

test.after(async () => {
  if (harness) await harness.cleanup();
});

test('packed artifact contains only required publishable runtime files and metadata', async () => {
  const files = /** @type {Array<{ path: string }>} */ (harness.packInfo.files);
  const packedPaths = files.map((f) => f.path);

  // Must include:
  assert.ok(packedPaths.includes('package.json'), 'package.json missing');
  assert.ok(packedPaths.includes('README.md'), 'README.md missing');
  assert.ok(packedPaths.includes('LICENSE'), 'LICENSE missing');
  assert.ok(packedPaths.includes('dist/cli.js'), 'dist/cli.js missing');
  assert.ok(packedPaths.includes('dist/run-cli.js'), 'dist/run-cli.js missing');
  assert.ok(packedPaths.includes('payload/v1/payload.json'), 'payload manifest missing');
  assert.ok(packedPaths.includes('payload/v1/skills/drakom-ai-setup/SKILL.md'), 'setup skill missing');
  assert.ok(packedPaths.includes('payload/v1/templates/drakom-ai.gitignore'), 'gitignore template missing');
  assert.ok(packedPaths.includes('payload/v1/templates/mcp-servers.yaml'), 'mcp template missing');
  assert.ok(packedPaths.includes('payload/v1/templates/rules.README.md'), 'rules README template missing');
  assert.ok(packedPaths.includes('payload/v1/templates/specs.README.md'), 'specs README template missing');

  // Must EXCLUDE development-only and source files:
  for (const item of packedPaths) {
    assert.equal(item.startsWith('src/'), false, `Source file ${item} must not be packed`);
    assert.equal(item.startsWith('scripts/'), false, `Script file ${item} must not be packed`);
    assert.equal(item.startsWith('test/'), false, `Test file ${item} must not be packed`);
    assert.equal(item.startsWith('.github/'), false, `CI file ${item} must not be packed`);
    assert.equal(item.startsWith('.ai/'), false, `.ai file ${item} must not be packed`);
    assert.equal(item.startsWith('.agents/'), false, `.agents file ${item} must not be packed`);
    assert.equal(item.startsWith('.claude/'), false, `.claude file ${item} must not be packed`);
    assert.equal(item.startsWith('.vscode/'), false, `.vscode file ${item} must not be packed`);
    assert.equal(item.startsWith('.codex/'), false, `.codex file ${item} must not be packed`);
    assert.notEqual(item, 'tsconfig.json');
    assert.notEqual(item, 'jsconfig.json');
    assert.notEqual(item, 'eslint.config.mjs');
    assert.notEqual(item, 'BOOTSTRAP.md');
  }

  // Verify unpacked package metadata
  const unpackedPkg = JSON.parse(
    await readFile(path.join(harness.unpackedDir, 'package', 'package.json'), 'utf8'),
  );
  assert.equal(unpackedPkg.name, '@drakom/ai-dev-kit');
  assert.equal(unpackedPkg.publishConfig?.access, 'public');
  assert.equal(unpackedPkg.private, undefined);
  assert.equal(unpackedPkg.bin?.['drakom-ai'], 'dist/cli.js');

  // Assert runtime dependencies are in production dependencies
  assert.ok(unpackedPkg.dependencies?.['js-yaml'], 'js-yaml must be declared in dependencies');
  assert.ok(unpackedPkg.dependencies?.['smol-toml'], 'smol-toml must be declared in dependencies');

  // Verify CLI executable permissions and shebang in unpacked package
  const cliFile = path.join(harness.unpackedDir, 'package', 'dist', 'cli.js');
  const cliStat = await stat(cliFile);
  assert.notEqual(cliStat.mode & 0o111, 0, 'dist/cli.js must be executable');
  const cliContent = await readFile(cliFile, 'utf8');
  assert.ok(cliContent.startsWith('#!/usr/bin/env node'), 'dist/cli.js must have node shebang');
});

test('pnpm dlx executes the packed artifact with zero network access', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'drakom-dlx-target-'));
  try {
    await writeFile(
      path.join(target, '.npmrc'),
      `cache-dir=${harness.pnpmCacheDir}\nstore-dir=${harness.pnpmStoreDir}\npnpmfile=${harness.hookPath}\noffline=true\nregistry=${OFFLINE_REGISTRY}\n`,
      'utf8',
    );
    const res = spawnSync(
      'pnpm',
      [
        ...harness.pnpmConfigArgs(),
        'dlx',
        `--package=file:${harness.kitTarball}`,
        'drakom-ai',
        'init',
        target,
        '--dry-run',
      ],
      {
        cwd: target,
        env: harness.pnpmEnv(),
        encoding: 'utf8',
      },
    );
    assert.equal(res.status, 0, `pnpm dlx failed: ${res.stderr}`);
    assert.match(res.stdout, /Drakom AI init plan/);
    assert.match(res.stdout, /Result: ready; no changes made\./);
    const files = await readdir(target);
    assert.equal(
      files.filter((f) => f !== '.npmrc').length,
      0,
      'dry-run must make zero filesystem mutations',
    );
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('pnpm add -D installs packed artifact and pnpm drakom-ai runs full consumption lifecycle', async () => {
  const consumer = await harness.createPnpmConsumer();
  try {
    // 1. Install packaged artifact offline
    const installRes = spawnSync(
      'pnpm',
      [...harness.pnpmConfigArgs(), 'add', '-D', `file:${harness.kitTarball}`],
      {
        cwd: consumer,
        env: harness.pnpmEnv(),
        encoding: 'utf8',
      },
    );
    assert.equal(installRes.status, 0, `pnpm add failed: ${installRes.stderr}`);

    const binPath = path.join(consumer, 'node_modules', '.bin', 'drakom-ai');
    await access(binPath);

    /**
     * Run installed drakom-ai binary in consumer project.
     * @param {string[]} args
     * @param {string} [input]
     */
    const runDrakom = (args, input) =>
      spawnSync('pnpm', [...harness.pnpmConfigArgs(), 'drakom-ai', ...args], {
        cwd: consumer,
        env: harness.pnpmEnv(),
        encoding: 'utf8',
        input,
      });

    // 2. Dry-run init makes zero changes
    const dryInit = runDrakom(['init', '.', '--dry-run']);
    assert.equal(dryInit.status, 0, dryInit.stderr);
    assert.match(dryInit.stdout, /Result: ready; no changes made\./);
    assert.equal(await readFile(path.join(consumer, 'AGENTS.md'), 'utf8').catch(() => null), null);

    // 3. Fresh project init --yes
    const initRes = runDrakom(['init', '.', '--yes']);
    assert.equal(initRes.status, 0, initRes.stderr);
    assert.match(initRes.stdout, /Ask your coding agent to use \$drakom-ai-setup/);
    assert.equal(await readFile(path.join(consumer, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
    assert.equal(await readFile(path.join(consumer, DRAKOM_DIR, 'mcp-servers.yaml'), 'utf8'), 'servers: {}\n');

    const state = JSON.parse(await readFile(path.join(consumer, DRAKOM_DIR, 'state.json'), 'utf8'));
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.kitVersion, '0.1.0');
    assert.ok(state.managedFiles['.agents/skills/drakom-ai-setup/SKILL.md']);

    // 4. Repeated initialization is idempotent
    const repeatInit = runDrakom(['init', '.', '--yes']);
    assert.equal(repeatInit.status, 0, repeatInit.stderr);

    // 5. Before initial sync, sync --check reports drift because Claude mirror needs initial sync
    const initialCheck = runDrakom(['sync', '.', '--check']);
    assert.notEqual(initialCheck.status, 0, 'sync --check must report drift before initial mirror sync');

    // 6. Synchronize initial mirrors
    const syncRes = runDrakom(['sync', '.']);
    assert.equal(syncRes.status, 0, syncRes.stderr);

    // Mirror created
    const mirrorPath = path.join(consumer, '.claude', 'skills', 'drakom-ai-setup', 'SKILL.md');
    const mirrorContent = await readFile(mirrorPath, 'utf8');
    assert.match(mirrorContent, /GENERATED MIRROR/);

    // 7. Post-sync clean check passes with exit code 0
    const cleanCheck = runDrakom(['sync', '.', '--check']);
    assert.equal(cleanCheck.status, 0, cleanCheck.stderr);

    // 8. Idempotent sync
    const idempotentSync = runDrakom(['sync', '.']);
    assert.equal(idempotentSync.status, 0, idempotentSync.stderr);
    const reCheck = runDrakom(['sync', '.', '--check']);
    assert.equal(reCheck.status, 0, reCheck.stderr);

    // 9. Drift detection: modify managed skill
    const skillPath = path.join(consumer, '.agents', 'skills', 'drakom-ai-setup', 'SKILL.md');
    const originalSkill = await readFile(skillPath, 'utf8');
    await writeFile(skillPath, `${originalSkill}\n# Local modification\n`, 'utf8');

    const driftCheck = runDrakom(['sync', '.', '--check']);
    assert.notEqual(driftCheck.status, 0, 'sync --check must fail when drift is introduced');

    // 10. Conflict prevention: sync stops writes on local modification
    const syncConflict = runDrakom(['sync', '.']);
    assert.notEqual(syncConflict.status, 0, 'sync must halt on conflict');
    assert.match(syncConflict.stdout, /Managed file was locally modified/);

    // Restore skill
    await writeFile(skillPath, originalSkill, 'utf8');
    assert.equal(runDrakom(['sync', '.', '--check']).status, 0);
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});

test('packed drakom-ai adopts existing projects with interactive approval and preserves unmanaged context', async () => {
  const consumer = await harness.createPnpmConsumer();
  try {
    const installRes = spawnSync(
      'pnpm',
      [...harness.pnpmConfigArgs(), 'add', '-D', `file:${harness.kitTarball}`],
      {
        cwd: consumer,
        env: harness.pnpmEnv(),
        encoding: 'utf8',
      },
    );
    assert.equal(installRes.status, 0, `pnpm add failed: ${installRes.stderr}`);

    // Create pre-existing context
    await writeFile(path.join(consumer, 'AGENTS.md'), '# Existing Project Policy\n', 'utf8');
    await writeFile(path.join(consumer, 'CLAUDE.md'), '# Claude Custom\n', 'utf8');
    await mkdir(path.join(consumer, '.ai'), { recursive: true });
    await writeFile(path.join(consumer, '.ai', 'custom-rule.md'), '# Custom Rule\n', 'utf8');
    await mkdir(path.join(consumer, '.agents', 'skills', 'custom-skill'), { recursive: true });
    await writeFile(
      path.join(consumer, '.agents', 'skills', 'custom-skill', 'SKILL.md'),
      '---\nname: custom\ndescription: Custom.\n---\n# Custom Skill\n',
      'utf8',
    );
    await writeFile(path.join(consumer, '.mcp.json'), JSON.stringify({ mcpServers: { myServer: { command: 'echo' } } }), 'utf8');

    // Interactive init with approval ('y')
    const initRes = spawnSync('pnpm', [...harness.pnpmConfigArgs(), 'drakom-ai', 'init', '.'], {
      cwd: consumer,
      env: harness.pnpmEnv(),
      encoding: 'utf8',
      input: 'y\n',
    });
    assert.equal(initRes.status, 0, initRes.stderr);

    // AGENTS.md was merged
    const agentsContent = await readFile(path.join(consumer, 'AGENTS.md'), 'utf8');
    assert.ok(agentsContent.startsWith('# Existing Project Policy\n\n<!-- drakom-ai:start -->'));

    // CLAUDE.md was merged
    const claudeContent = await readFile(path.join(consumer, 'CLAUDE.md'), 'utf8');
    assert.ok(claudeContent.startsWith('# Claude Custom\n\n@AGENTS.md'));

    // Unrelated .ai/, custom skills, and unmanaged MCP servers preserved byte-for-byte
    assert.equal(await readFile(path.join(consumer, '.ai', 'custom-rule.md'), 'utf8'), '# Custom Rule\n');
    assert.equal(
      await readFile(path.join(consumer, '.agents', 'skills', 'custom-skill', 'SKILL.md'), 'utf8'),
      '---\nname: custom\ndescription: Custom.\n---\n# Custom Skill\n',
    );
    const mcpJson = JSON.parse(await readFile(path.join(consumer, '.mcp.json'), 'utf8'));
    assert.ok(mcpJson.mcpServers.myServer);
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});

test('packed drakom-ai updates a prior-version fixture with genuinely older managed content and matching fingerprints', async () => {
  const consumer = await harness.createPnpmConsumer();
  try {
    const installRes = spawnSync(
      'pnpm',
      [...harness.pnpmConfigArgs(), 'add', '-D', `file:${harness.kitTarball}`],
      {
        cwd: consumer,
        env: harness.pnpmEnv(),
        encoding: 'utf8',
      },
    );
    assert.equal(installRes.status, 0, `pnpm add failed: ${installRes.stderr}`);

    /** @param {string[]} args */
    const runDrakom = (args) =>
      spawnSync('pnpm', [...harness.pnpmConfigArgs(), 'drakom-ai', ...args], {
        cwd: consumer,
        env: harness.pnpmEnv(),
        encoding: 'utf8',
      });

    const oldSkillContent = '---\nname: drakom-ai-setup\ndescription: Old v0.0.9 setup skill\n---\n# Old Setup v0.0.9\n';
    const oldAssessmentContent = '# Old Assessment Template v0.0.9\n';
    const oldSkillFp = sha256(oldSkillContent);
    const oldAssessmentFp = sha256(oldAssessmentContent);

    // Setup v0.0.9 state and managed files
    await mkdir(path.join(consumer, DRAKOM_DIR), { recursive: true });
    await mkdir(path.join(consumer, '.agents', 'skills', 'drakom-ai-setup', 'references'), { recursive: true });

    await writeFile(
      path.join(consumer, '.agents', 'skills', 'drakom-ai-setup', 'SKILL.md'),
      oldSkillContent,
      'utf8',
    );
    await writeFile(
      path.join(consumer, '.agents', 'skills', 'drakom-ai-setup', 'references', 'assessment-plan-template.md'),
      oldAssessmentContent,
      'utf8',
    );
    await writeFile(path.join(consumer, DRAKOM_DIR, 'mcp-servers.yaml'), 'servers: {}\n', 'utf8');
    await writeFile(path.join(consumer, DRAKOM_DIR, '.gitignore'), 'plans/*\nassets/*\n', 'utf8');
    await writeFile(path.join(consumer, 'AGENTS.md'), '<!-- drakom-ai:start -->\n## Drakom AI\n<!-- drakom-ai:end -->\n', 'utf8');
    await writeFile(path.join(consumer, 'CLAUDE.md'), '@AGENTS.md\n', 'utf8');

    const v009State = {
      schemaVersion: 1,
      kitVersion: '0.0.9',
      features: { mcp: true, skillMirrors: true },
      managedFiles: {
        '.agents/skills/drakom-ai-setup/SKILL.md': {
          source: 'skills/drakom-ai-setup/SKILL.md',
          fingerprint: oldSkillFp,
        },
        '.agents/skills/drakom-ai-setup/references/assessment-plan-template.md': {
          source: 'skills/drakom-ai-setup/references/assessment-plan-template.md',
          fingerprint: oldAssessmentFp,
        },
      },
      managedBlocks: {},
      managedMcpServers: {},
    };
    await writeFile(path.join(consumer, DRAKOM_DIR, 'state.json'), JSON.stringify(v009State, null, 2), 'utf8');

    // 1. sync --check detects drift because v0.0.9 is older than CLI payload v0.1.0
    const checkRes = runDrakom(['sync', '.', '--check']);
    assert.notEqual(checkRes.status, 0, 'sync --check must report drift when prior version is installed');

    // 2. sync --dry-run previews updates
    const dryRes = runDrakom(['sync', '.', '--dry-run']);
    assert.equal(dryRes.status, 0, dryRes.stderr);
    assert.match(dryRes.stdout, /Update managed file from kit version 0\.1\.0\./);

    // Old content still in place after dry-run
    assert.equal(
      await readFile(path.join(consumer, '.agents', 'skills', 'drakom-ai-setup', 'SKILL.md'), 'utf8'),
      oldSkillContent,
    );

    // 3. sync performs genuine update
    const syncRes = runDrakom(['sync', '.']);
    assert.equal(syncRes.status, 0, syncRes.stderr);

    // Updated content matches current payload v0.1.0, not old content
    const newSkillContent = await readFile(path.join(consumer, '.agents', 'skills', 'drakom-ai-setup', 'SKILL.md'), 'utf8');
    assert.notEqual(newSkillContent, oldSkillContent);
    assert.match(newSkillContent, /languages, manifests, package managers/i);

    // State updated to v0.1.0 and new fingerprint recorded
    const updatedState = JSON.parse(await readFile(path.join(consumer, DRAKOM_DIR, 'state.json'), 'utf8'));
    assert.equal(updatedState.kitVersion, '0.1.0');
    assert.equal(updatedState.managedFiles['.agents/skills/drakom-ai-setup/SKILL.md'].fingerprint, sha256(newSkillContent));

    // Post-update sync --check passes clean
    const postCheck = runDrakom(['sync', '.', '--check']);
    assert.equal(postCheck.status, 0, postCheck.stderr);
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});

test('npm install installs packed artifact and provides additional runtime coverage', async () => {
  const consumer = await mkdtemp(path.join(os.tmpdir(), 'drakom-consumer-npm-'));
  try {
    await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer-npm', private: true }), 'utf8');
    await writeFile(
      path.join(consumer, '.npmrc'),
      `cache=${harness.npmCacheDir}\noffline=true\nregistry=${OFFLINE_REGISTRY}\n`,
      'utf8',
    );

    const res = spawnSync(
      'npm',
      [
        'install',
        '--offline',
        `--registry=${OFFLINE_REGISTRY}`,
        `--cache=${harness.npmCacheDir}`,
        '--no-audit',
        harness.argparseTarball,
        harness.jsyamlTarball,
        harness.smoltomlTarball,
        harness.kitTarball,
      ],
      {
        cwd: consumer,
        env: {
          ...process.env,
          npm_config_cache: harness.npmCacheDir,
        },
        encoding: 'utf8',
      },
    );
    assert.equal(res.status, 0, `npm install failed: ${res.stderr}`);

    const binPath = path.join(consumer, 'node_modules', '.bin', 'drakom-ai');
    await access(binPath);

    const helpRes = spawnSync(binPath, ['--help'], {
      cwd: consumer,
      env: {
        ...process.env,
        npm_config_cache: harness.npmCacheDir,
      },
      encoding: 'utf8',
    });
    assert.equal(helpRes.status, 0, helpRes.stderr);
    assert.match(helpRes.stdout, /Usage: drakom-ai <command>/);

    const initRes = spawnSync(binPath, ['init', '.', '--yes'], {
      cwd: consumer,
      env: {
        ...process.env,
        npm_config_cache: harness.npmCacheDir,
      },
      encoding: 'utf8',
    });
    assert.equal(initRes.status, 0, initRes.stderr);
    assert.match(initRes.stdout, /Ask your coding agent to use \$drakom-ai-setup/);
    assert.equal(await readFile(path.join(consumer, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});
