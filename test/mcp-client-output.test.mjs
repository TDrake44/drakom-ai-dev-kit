import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DRAKOM_DIR } from '../dist/constants.js';
import { validateMcpRegistry } from '../dist/mcp-registry.js';
import { generateAntigravityServer, generateClaudeServer } from '../dist/mcp-renderers.js';
import { validateState } from '../dist/state.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');
const REGISTRY = `${DRAKOM_DIR}/mcp-servers.yaml`;
const STATE = `${DRAKOM_DIR}/state.json`;
const ROOT = '.mcp.json';
const VSCODE = '.vscode/mcp.json';
const ANTIGRAVITY = '.agents/mcp_config.json';
const CODEX = '.codex/config.toml';

/**
 * @param {string} command
 * @param {string} root
 * @param {string[]} [options]
 */
function drakom(command, root, options = []) {
  return spawnSync(process.execPath, [cliPath, command, root, ...options], { encoding: 'utf8' });
}

/** @param {string} root @param {string} relativePath */
function read(root, relativePath) {
  return readFile(path.join(root, ...relativePath.split('/')), 'utf8');
}

/** @param {string} root @param {string} relativePath @param {string} content */
async function write(root, relativePath, content) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

/** @param {string} root @param {string} relativePath */
async function exists(root, relativePath) {
  try {
    await access(path.join(root, ...relativePath.split('/')));
    return true;
  } catch {
    return false;
  }
}

/** @param {string} root @param {string} relativePath */
async function readJson(root, relativePath) {
  return JSON.parse(await read(root, relativePath));
}

/** @param {string} root */
function readState(root) {
  return readJson(root, STATE);
}

/** @type {string[]} Temporary targets made by the running test, removed when it ends. */
const createdRoots = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * An initialized target with the given registry, not yet synchronized.
 * @param {string} registry
 */
async function createTarget(registry) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drakom-mcp-output-'));
  createdRoots.push(root);
  const init = drakom('init', root, ['--yes']);
  assert.equal(init.status, 0, init.stderr);
  await write(root, REGISTRY, registry);
  return root;
}

/** @param {string} root @param {string[]} [options] */
function syncOk(root, options = []) {
  const result = drakom('sync', root, options);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}

/** @param {string} root */
function assertInSync(root) {
  const check = drakom('sync', root, ['--check']);
  assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
  assert.doesNotMatch(check.stdout, /^(CONFLICT|WARNING)/m);
}

/** @param {string} root */
function assertNoDrift(root) {
  const check = drakom('sync', root, ['--check']);
  assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
  assert.doesNotMatch(check.stdout, /^(CONFLICT|CREATE|UPDATE|DELETE)/m);
}

/** @param {string} stdout @param {string} label */
function rows(stdout, label) {
  return stdout.split('\n').filter((line) => line.startsWith(label));
}

/** @param {unknown} raw */
function validationErrorOf(raw) {
  const result = validateMcpRegistry(raw);
  assert.equal(result.valid, false, 'expected the registry to be rejected');
  return result.valid ? '' : result.error;
}

/** @param {unknown} raw @param {string} name */
function validServer(raw, name) {
  const result = validateMcpRegistry(raw);
  assert.ok(result.valid, result.valid ? '' : result.error);
  const server = result.registry.servers[name];
  assert.ok(server);
  return server;
}

const TWO_SERVERS = `servers:
  alpha:
    command: node
    args: ['./alpha.mjs']
  beta:
    command: node
    args: ['./beta.mjs']
`;
const ALPHA_ONLY = `servers:
  alpha:
    command: node
    args: ['./alpha.mjs']
`;

// ---------------------------------------------------------------------------
// Antigravity fields
// ---------------------------------------------------------------------------

test('Antigravity gets serverUrl, headers and timeoutSeconds, and no transport or timeout', () => {
  const server = validServer(
    {
      servers: {
        docs: {
          http: { url: 'https://mcp.example.com/docs', type: 'http', headers: { 'X-Client': 'kit' } },
          overrides: { antigravity: { timeoutSeconds: 600 } },
        },
      },
    },
    'docs',
  );

  assert.deepEqual(generateAntigravityServer(server), {
    serverUrl: 'https://mcp.example.com/docs',
    headers: { 'X-Client': 'kit' },
    timeoutSeconds: 600,
  });
});

test('Antigravity gets timeoutSeconds on a local server', () => {
  const server = validServer({ servers: { local: { command: 'node', overrides: { antigravity: { timeoutSeconds: -1 } } } } }, 'local');

  assert.deepEqual(generateAntigravityServer(server), { command: 'node', timeoutSeconds: -1 });
  assert.deepEqual(generateClaudeServer(server), { command: 'node' });
});

test('timeoutSeconds is validated and belongs to the antigravity override only', () => {
  assert.match(
    validationErrorOf({ servers: { s: { command: 'node', overrides: { antigravity: { timeoutSeconds: '600' } } } } }),
    /timeoutSeconds must be a finite number/,
  );
  assert.match(
    validationErrorOf({ servers: { s: { command: 'node', overrides: { codex: { timeoutSeconds: 600 } } } } }),
    /timeoutSeconds is only supported in overrides\.antigravity/,
  );
});

test('the old Antigravity override keys are still accepted, are not written, and are named in a warning', async () => {
  const root = await createTarget(`servers:
  documentation:
    http:
      url: https://mcp.example.com/docs
    overrides:
      antigravity:
        serverUrl: https://mcp.example.com/docs
        transport: http
        timeout: 30000
`);

  const result = syncOk(root);

  assert.deepEqual((await readJson(root, ANTIGRAVITY)).mcpServers.documentation, { serverUrl: 'https://mcp.example.com/docs' });
  const warnings = rows(result.stdout, 'WARNING');
  assert.equal(warnings.length, 1, result.stdout);
  assert.match(warnings[0] ?? '', /"documentation".*overrides\.antigravity\.transport.*overrides\.antigravity\.timeout.*timeoutSeconds/);
  assertNoDrift(root);
});

test('an Antigravity file written with transport and timeout is corrected without a conflict', async () => {
  const registry = `servers:
  documentation:
    http:
      url: https://mcp.example.com/docs
    overrides:
      antigravity:
        timeoutSeconds: 30
`;
  const root = await createTarget(registry);
  syncOk(root);
  // What the previous release wrote and recorded for this server.
  const old = { serverUrl: 'https://mcp.example.com/docs', transport: 'http', timeout: 30000 };
  await write(root, ANTIGRAVITY, `${JSON.stringify({ mcpServers: { documentation: old } }, null, 2)}\n`);
  const { fingerprintObject } = await import('../dist/mcp-renderers.js');
  const state = await readState(root);
  state.managedMcpServers.documentation.targetFingerprints[ANTIGRAVITY] = fingerprintObject(old);
  await write(root, STATE, `${JSON.stringify(state, null, 2)}\n`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^CONFLICT/m);
  assert.deepEqual((await readJson(root, ANTIGRAVITY)).mcpServers.documentation, {
    serverUrl: 'https://mcp.example.com/docs',
    timeoutSeconds: 30,
  });
  assertInSync(root);
});

test('an Antigravity entry the user already corrected by hand is recorded, not a conflict', async () => {
  const registry = `servers:
  documentation:
    http:
      url: https://mcp.example.com/docs
`;
  const root = await createTarget(registry);
  syncOk(root);
  // The previous release wrote and recorded the entry with transport and timeout; the user has since
  // deleted those two fields by hand, so the file already holds what this release writes.
  const written = await read(root, ANTIGRAVITY);
  const { fingerprintObject } = await import('../dist/mcp-renderers.js');
  const state = await readState(root);
  state.managedMcpServers.documentation.targetFingerprints[ANTIGRAVITY] = fingerprintObject({
    serverUrl: 'https://mcp.example.com/docs',
    transport: 'sse',
    timeout: 30000,
  });
  await write(root, STATE, `${JSON.stringify(state, null, 2)}\n`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^CONFLICT/m);
  assert.equal(await read(root, ANTIGRAVITY), written);
  assert.equal(
    (await readState(root)).managedMcpServers.documentation.targetFingerprints[ANTIGRAVITY],
    fingerprintObject({ serverUrl: 'https://mcp.example.com/docs' }),
  );
  assertInSync(root);
});

test('a JSON entry edited by hand to exactly what the registry now generates is not a conflict', async () => {
  const root = await createTarget(ALPHA_ONLY);
  syncOk(root);
  const edited = (await read(root, ROOT)).replace('./alpha.mjs', './changed.mjs');
  await write(root, ROOT, edited);
  await write(root, REGISTRY, ALPHA_ONLY.replace('./alpha.mjs', './changed.mjs'));

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^CONFLICT/m);
  assert.equal(await read(root, ROOT), edited);
  assertInSync(root);
});

test('the example registry uses the documented Antigravity fields and raises no warning', async () => {
  const example = await readFile(path.join(repositoryRoot, 'examples', 'mcp-servers.yaml'), 'utf8');
  const root = await createTarget(example);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^(CONFLICT|WARNING)/m);
  const documentation = (await readJson(root, ANTIGRAVITY)).mcpServers.documentation;
  assert.deepEqual(Object.keys(documentation).sort(), ['headers', 'serverUrl', 'timeoutSeconds']);
});

// ---------------------------------------------------------------------------
// The root .mcp.json is shared by Claude Code and VS Code
// ---------------------------------------------------------------------------

test('an all-clients registry produces the same client files and state as before the shared root file', async () => {
  const baseline = JSON.parse(await readFile(path.join(repositoryRoot, 'test', 'fixtures', 'mcp-all-clients-baseline.json'), 'utf8'));
  const root = await createTarget(baseline.registry);

  const result = syncOk(root);

  for (const file of [ROOT, VSCODE, ANTIGRAVITY, CODEX]) {
    assert.equal(await read(root, file), baseline.files[file], file);
  }
  assert.equal(JSON.stringify((await readState(root)).managedMcpServers), JSON.stringify(baseline.managedMcpServers));
  assert.doesNotMatch(result.stdout, /^CONFLICT/m);
  assertNoDrift(root);
});

test('vscode without claude also gets the root .mcp.json', async () => {
  const root = await createTarget(`clients: [vscode, codex]
servers:
  tracker:
    http:
      url: https://mcp.example.com/issues
      headers:
        Authorization: "Bearer \${TRACKER_TOKEN}"
  tools:
    command: node
    args: ['./tools.mjs']
    env:
      REGION: \${env:REGION}
`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^(CONFLICT|WARNING)/m);
  assert.deepEqual(await readJson(root, ROOT), {
    mcpServers: {
      tracker: { type: 'http', url: 'https://mcp.example.com/issues', headers: { Authorization: 'Bearer ${TRACKER_TOKEN}' } },
      tools: { command: 'node', args: ['./tools.mjs'], env: { REGION: '${REGION}' } },
    },
  });
  assert.deepEqual((await readJson(root, VSCODE)).servers.tools, {
    type: 'stdio',
    command: 'node',
    args: ['./tools.mjs'],
    env: { REGION: '${env:REGION}' },
  });
  assert.equal(await exists(root, ANTIGRAVITY), false);
  assert.deepEqual(Object.keys((await readState(root)).managedMcpServers.tools.targetFingerprints), [ROOT, VSCODE, CODEX]);
  assertInSync(root);
});

test('without claude, the root .mcp.json carries the vscode override', async () => {
  const root = await createTarget(`clients: [vscode]
servers:
  tools:
    command: node
    args: ['./tools.mjs']
    overrides:
      vscode:
        args: ['./vscode-tools.mjs']
      claude:
        args: ['./claude-tools.mjs']
`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^(CONFLICT|WARNING)/m);
  assert.deepEqual((await readJson(root, ROOT)).mcpServers.tools, { command: 'node', args: ['./vscode-tools.mjs'] });
  assert.deepEqual((await readJson(root, VSCODE)).servers.tools, { type: 'stdio', command: 'node', args: ['./vscode-tools.mjs'] });
  assertInSync(root);
});

test('with both clients, the claude version wins in the root file and a warning says so', async () => {
  const root = await createTarget(`clients: [claude, vscode]
servers:
  tools:
    command: node
    args: ['./tools.mjs']
    overrides:
      vscode:
        args: ['./vscode-tools.mjs']
  same:
    command: node
`);

  const result = syncOk(root);

  assert.deepEqual((await readJson(root, ROOT)).mcpServers.tools, { command: 'node', args: ['./tools.mjs'] });
  assert.deepEqual((await readJson(root, VSCODE)).servers.tools, { type: 'stdio', command: 'node', args: ['./vscode-tools.mjs'] });
  const warnings = rows(result.stdout, 'WARNING');
  assert.equal(warnings.length, 1, result.stdout);
  assert.match(warnings[0] ?? '', /WARNING\s+\.mcp\.json.*"tools".*claude version.*only.*\.vscode\/mcp\.json/);
  assertNoDrift(root);
});

test('a server skipped for claude stays out of the root file, and vscode gets it from .vscode/mcp.json with a warning', async () => {
  const root = await createTarget(`servers:
  tools:
    command: node
    skip: [claude]
  other:
    command: node
    skip: [claude, vscode]
  shared:
    command: node
`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^CONFLICT/m);
  const warnings = rows(result.stdout, 'WARNING');
  assert.equal(warnings.length, 1, result.stdout);
  assert.match(warnings[0] ?? '', /WARNING\s+\.mcp\.json.*"tools".*skips claude.*Copilot harness.*\.vscode\/mcp\.json/);
  assert.deepEqual(await readJson(root, ROOT), { mcpServers: { shared: { command: 'node' } } });
  assert.deepEqual((await readJson(root, VSCODE)).servers.tools, { type: 'stdio', command: 'node' });
  const state = await readState(root);
  assert.deepEqual(Object.keys(state.managedMcpServers.tools.targetFingerprints), [VSCODE, ANTIGRAVITY, CODEX]);
  assert.deepEqual(Object.keys(state.managedMcpServers.other.targetFingerprints), [ANTIGRAVITY, CODEX]);
  assertNoDrift(root);
});

test('skip: [claude] keeps a server out of the root file even when claude is not in clients', async () => {
  const root = await createTarget(`clients: [vscode]
servers:
  tools:
    command: node
    skip: [claude]
  plain:
    command: node
`);

  const result = syncOk(root);

  assert.equal(rows(result.stdout, 'WARNING').length, 1, result.stdout);
  assert.deepEqual(await readJson(root, ROOT), { mcpServers: { plain: { command: 'node' } } });
  assert.deepEqual(Object.keys((await readState(root)).managedMcpServers.tools.targetFingerprints), [VSCODE]);
  assertNoDrift(root);
});

test('upgrading leaves a user\'s own same-name root entry alone when the server skips claude', async () => {
  const root = await createTarget(`servers:
  s1:
    command: node
    skip: [claude]
`);
  const own = `${JSON.stringify({ mcpServers: { s1: { command: 'python', args: ['mine.py'] } } }, null, 2)}\n`;
  await write(root, ROOT, own);

  const result = drakom('sync', root);

  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /^CONFLICT/m);
  assert.equal(await read(root, ROOT), own);
  assert.deepEqual((await readJson(root, VSCODE)).servers.s1, { type: 'stdio', command: 'node' });
  assertNoDrift(root);
});

test('a server that prompts with ${input:} goes to .vscode/mcp.json only, with a warning', async () => {
  const root = await createTarget(`clients: [vscode]
servers:
  prompted:
    command: node
    env:
      REGION: "\${input:region}"
  plain:
    command: node
`);

  const result = syncOk(root);

  assert.deepEqual(await readJson(root, ROOT), { mcpServers: { plain: { command: 'node' } } });
  assert.deepEqual((await readJson(root, VSCODE)).servers.prompted, {
    type: 'stdio',
    command: 'node',
    env: { REGION: '${input:region}' },
  });
  const warnings = rows(result.stdout, 'WARNING');
  assert.equal(warnings.length, 1, result.stdout);
  assert.match(warnings[0] ?? '', /WARNING\s+\.mcp\.json.*"prompted".*\$\{input:region\}.*\.vscode\/mcp\.json only/);
  const state = await readState(root);
  assert.deepEqual(Object.keys(state.managedMcpServers.prompted.targetFingerprints), [VSCODE]);
  assert.deepEqual(Object.keys(state.managedMcpServers.plain.targetFingerprints), [ROOT, VSCODE]);
  assertNoDrift(root);
});

test('no root file is created when ${input:} keeps every vscode server out of it', async () => {
  const root = await createTarget(`clients: [vscode]
servers:
  prompted:
    command: node
    overrides:
      vscode:
        env:
          REGION: "\${input:region}"
`);

  const result = syncOk(root);

  assert.equal(await exists(root, ROOT), false);
  assert.equal(rows(result.stdout, 'WARNING').length, 1, result.stdout);
  assert.equal((await readJson(root, VSCODE)).servers.prompted.env.REGION, '${input:region}');
});

test('the ${input:} refusal for another client names skip for that client', async () => {
  const root = await createTarget(`servers:
  prompted:
    command: node
    env:
      REGION: "\${input:region}"
`);

  const result = drakom('sync', root);

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /CONFLICT.*"prompted".*\$\{input:region\}.*overrides\.vscode.*skip: \[claude\]/);
  assert.equal(await exists(root, ROOT), false);

  await write(root, REGISTRY, (await read(root, REGISTRY)).replace('    command: node\n', '    command: node\n    skip: [claude, antigravity, codex]\n'));
  const skipped = syncOk(root);
  assert.equal(rows(skipped.stdout, 'WARNING').length, 1, skipped.stdout);
  assert.equal(await exists(root, ROOT), false);
  assert.equal((await readJson(root, VSCODE)).servers.prompted.env.REGION, '${input:region}');
});

test('deselecting claude keeps the root file while vscode is selected', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  const rootBefore = await read(root, ROOT);
  await write(root, REGISTRY, `clients: [vscode]\n${TWO_SERVERS}`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^(CONFLICT|WARNING)/m);
  assert.equal(await read(root, ROOT), rootBefore);
  assert.deepEqual(Object.keys((await readState(root)).managedMcpServers.alpha.targetFingerprints), [ROOT, VSCODE]);
  assertInSync(root);
});

test('deselecting vscode keeps the root file for claude and removes the vscode entries', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  const rootBefore = await read(root, ROOT);
  await write(root, REGISTRY, `clients: [claude]\n${TWO_SERVERS}`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^(CONFLICT|WARNING)/m);
  assert.equal(await read(root, ROOT), rootBefore);
  assert.deepEqual((await readJson(root, VSCODE)).servers, {});
  assertInSync(root);
});

test('deselecting both claude and vscode releases the root file', async () => {
  const root = await createTarget(TWO_SERVERS);
  await write(root, ROOT, `${JSON.stringify({ mcpServers: { mine: { command: 'python' } } }, null, 2)}\n`);
  syncOk(root);
  await write(root, REGISTRY, `clients: [codex]\n${TWO_SERVERS}`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^(CONFLICT|WARNING)/m);
  assert.deepEqual(await readJson(root, ROOT), { mcpServers: { mine: { command: 'python' } } });
  assert.deepEqual(Object.keys((await readState(root)).managedMcpServers.alpha.targetFingerprints), [CODEX]);
  assertInSync(root);
});

test('the root file switches to the vscode version when claude is deselected', async () => {
  const registry = `servers:
  tools:
    command: node
    args: ['./tools.mjs']
    overrides:
      vscode:
        args: ['./vscode-tools.mjs']
`;
  const root = await createTarget(`clients: [claude, vscode]\n${registry}`);
  syncOk(root);
  await write(root, REGISTRY, `clients: [vscode]\n${registry}`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^(CONFLICT|WARNING)/m);
  assert.deepEqual((await readJson(root, ROOT)).mcpServers.tools, { command: 'node', args: ['./vscode-tools.mjs'] });
  assertInSync(root);
});

test('the README explains the VS Code move to the root file', async () => {
  const readme = await readFile(path.join(repositoryRoot, 'README.md'), 'utf8');

  assert.match(readme, /February 2027/);
  assert.match(readme, /Local harness/);
  assert.match(readme, /`\.mcp\.json` for Claude Code, GitHub Copilot CLI and VS Code/);
});

// ---------------------------------------------------------------------------
// "__proto__" as a recorded or registry name
// ---------------------------------------------------------------------------

/** @param {string} managedJson the text of the state's name-keyed maps */
function stateWith(managedJson) {
  return JSON.parse(
    `{"schemaVersion":1,"kitVersion":"0.5.0","features":{"mcp":true,"skillMirrors":true},"managedFiles":{},"managedMcpServers":{},${managedJson.slice(1)}`,
  );
}

const FP = `sha256:${'0'.repeat(64)}`;

test('validateState rejects a "__proto__" name in every name-keyed map', () => {
  const server = `{"sourceFingerprint":"${FP}","targetFingerprints":{}}`;
  const cases = [
    { map: 'managedMcpServers', json: `{"managedMcpServers":{"__proto__":${server}}}` },
    { map: 'managedMcpServers', json: `{"managedMcpServers":{"ok":{"sourceFingerprint":"${FP}","targetFingerprints":{"__proto__":"${FP}"}}}}` },
    { map: 'managedFiles', json: `{"managedFiles":{"__proto__":{"source":"a","fingerprint":"${FP}"}}}` },
    { map: 'managedBlocks', json: `{"managedBlocks":{"__proto__":{"fingerprint":"${FP}"}}}` },
    { map: 'managedSkillMirrors', json: `{"managedSkillMirrors":{"__proto__":{"fingerprint":"${FP}"}}}` },
  ];
  for (const { map, json } of cases) {
    assert.throws(
      () => validateState(stateWith(json)),
      (error) => error instanceof Error && error.message.includes('"__proto__"') && error.message.includes(map) && /remove/i.test(error.message),
      json,
    );
  }
  assert.equal(Object.getPrototypeOf({}).sourceFingerprint, undefined);
});

test('validateState keeps accepting "constructor" as a server name', () => {
  const state = validateState(
    stateWith(`{"managedMcpServers":{"constructor":{"sourceFingerprint":"${FP}","targetFingerprints":{".mcp.json":"${FP}"}}}}`),
  );

  assert.deepEqual(Object.keys(state.managedMcpServers), ['constructor']);
});

test('sync stops with a clear error when state records a "__proto__" server', async () => {
  const root = await createTarget(ALPHA_ONLY);
  syncOk(root);
  const stateText = await read(root, STATE);
  await write(root, STATE, stateText.replace('"managedMcpServers": {', `"managedMcpServers": {\n    "__proto__": {"sourceFingerprint":"${FP}","targetFingerprints":{}},`));

  const result = drakom('sync', root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /state\.json.*"__proto__".*managedMcpServers.*reserved/);
});

test('the registry rejects "__proto__" as an env or header name and still accepts "constructor"', () => {
  const env = JSON.parse('{"servers":{"s":{"command":"node","env":{"__proto__":"x"}}}}');
  assert.match(validationErrorOf(env), /MCP server "s".*"__proto__".*reserved/);
  const header = JSON.parse('{"servers":{"s":{"http":{"url":"https://mcp.example.com"},"overrides":{"codex":{"headers":{"__proto__":"x"}}}}}}');
  assert.match(validationErrorOf(header), /MCP server "s".*"__proto__".*reserved/);

  const server = validServer({ servers: { constructor: { command: 'node', env: { constructor: 'x' } } } }, 'constructor');
  assert.deepEqual(generateClaudeServer(server), { command: 'node', env: { constructor: 'x' } });
});

test('a registry server named "__proto__" is refused by sync, and one named "constructor" is synchronized', async () => {
  const root = await createTarget(`servers:
  __proto__:
    command: node
`);

  const refused = drakom('sync', root);

  assert.equal(refused.status, 2, refused.stdout);
  assert.match(refused.stdout, /CONFLICT.*server name "__proto__" is reserved; rename the server/);
  assert.equal(await exists(root, ROOT), false);

  await write(root, REGISTRY, `servers:
  constructor:
    command: node
`);
  syncOk(root);

  assert.deepEqual(await readJson(root, ROOT), { mcpServers: { constructor: { command: 'node' } } });
  assert.deepEqual(Object.keys((await readState(root)).managedMcpServers), ['constructor']);
  assertInSync(root);
});
