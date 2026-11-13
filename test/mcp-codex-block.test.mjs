import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseTomlText } from 'smol-toml';

import { removeCodexServerFromToml } from '../dist/codex-toml.js';
import { DRAKOM_DIR } from '../dist/constants.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');
const REGISTRY = `${DRAKOM_DIR}/mcp-servers.yaml`;
const STATE = `${DRAKOM_DIR}/state.json`;
const CODEX = '.codex/config.toml';
const BLOCK_START = '# BEGIN Drakom AI Development Context MCP servers';
const BLOCK_END = '# END Drakom AI Development Context MCP servers';

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

/** @param {string} root */
async function readState(root) {
  return JSON.parse(await read(root, STATE));
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

/**
 * Parses TOML into plain objects, so that deepEqual compares values and not the parser's prototypes.
 * @param {string} text
 * @returns {Record<string, any>}
 */
function parseToml(text) {
  return JSON.parse(JSON.stringify(parseTomlText(text)));
}

/** @param {string} stdout @param {string} label */
function rows(stdout, label) {
  return stdout.split('\n').filter((line) => line.startsWith(label));
}

/** Every line ending is CRLF. @param {string} text */
function assertOnlyCrlf(text) {
  assert.doesNotMatch(text, /(^|[^\r])\n/, 'found a bare LF in a CRLF file');
}

/** @param {string} text @param {string} needle */
function count(text, needle) {
  return text.split(needle).length - 1;
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
const ALPHA_TABLE = '[mcp_servers.alpha]\ncommand = "node"\nargs = ["./alpha.mjs"]\n';

// ---------------------------------------------------------------------------
// Codex: the managed block stays where it is
// ---------------------------------------------------------------------------

test('the Codex block is rewritten in place when the file is edited around it', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  const block = await read(root, CODEX);
  const before = '# my settings\nmodel = "example"\n\n\n\n';
  const after = '\n\n[profiles.mine]\nmodel = "other"   # trailing spaces follow   \n\n';
  await write(root, CODEX, `${before}${block}${after}`);

  // Text around the block is not drift.
  assertInSync(root);
  assert.equal(await read(root, CODEX), `${before}${block}${after}`);

  await write(root, REGISTRY, TWO_SERVERS.replace('./alpha.mjs', './changed.mjs'));
  const result = syncOk(root);

  assert.equal(rows(result.stdout, 'UPDATE   .codex/config.toml').length, 1);
  const updated = await read(root, CODEX);
  assert.equal(updated, `${before}${block.replace('./alpha.mjs', './changed.mjs')}${after}`);
  parseToml(updated);
  assertInSync(root);
});

test('the Codex block stays in place when its last server leaves the registry', async () => {
  const root = await createTarget(ALPHA_ONLY);
  syncOk(root);
  const block = await read(root, CODEX);
  await write(root, CODEX, `model = "example"\n\n${block}\n[profiles.mine]\nmodel = "other"\n`);
  await write(root, REGISTRY, 'servers: {}\n');

  syncOk(root);

  assert.equal(await read(root, CODEX), `model = "example"\n\n${BLOCK_START}\n${BLOCK_END}\n\n[profiles.mine]\nmodel = "other"\n`);
  assertInSync(root);
});

test('a CRLF Codex file gets a CRLF block and keeps its text byte for byte', async () => {
  const root = await createTarget(TWO_SERVERS);
  const original = 'model = "example"\r\n\r\n[profiles.mine]\r\nmodel = "other"\r\n';
  await write(root, CODEX, original);

  syncOk(root);

  const first = await read(root, CODEX);
  assertOnlyCrlf(first);
  assert.ok(first.startsWith(original));
  assert.match(first, /\[mcp_servers\.alpha\]\r\ncommand = "node"\r\n/);
  parseToml(first);
  assertInSync(root);

  // Edited around the block, then regenerated: both sides survive and no ending is mixed in.
  const blockStart = first.indexOf(BLOCK_START);
  const before = `# top\r\n${first.slice(0, blockStart)}`;
  const block = first.slice(blockStart);
  const after = '\r\n[profiles.second]\r\nmodel = "third"\r\n';
  await write(root, CODEX, `${before}${block}${after}`);
  assertInSync(root);
  await write(root, REGISTRY, TWO_SERVERS.replace('./beta.mjs', './changed.mjs'));

  syncOk(root);

  const second = await read(root, CODEX);
  assertOnlyCrlf(second);
  assert.equal(second, `${before}${block.replace('./beta.mjs', './changed.mjs')}${after}`);
  parseToml(second);
  assertInSync(root);
});

test('a block the kit wrote with LF into a CRLF file is rewritten with CRLF', async () => {
  const root = await createTarget(ALPHA_ONLY);
  syncOk(root);
  const lfBlock = await read(root, CODEX);
  // What earlier releases produced for a CRLF file: CRLF text around an LF block.
  await write(root, CODEX, `model = "example"\r\n\r\n${lfBlock}`);

  syncOk(root);

  const text = await read(root, CODEX);
  assertOnlyCrlf(text);
  assert.equal(text, `model = "example"\r\n\r\n${lfBlock.replaceAll('\n', '\r\n')}`);
  assertInSync(root);
});

// ---------------------------------------------------------------------------
// Codex: unmanaged servers written as inline tables or dotted keys
// ---------------------------------------------------------------------------

const UNMANAGED_FORMS = [
  {
    form: 'a root inline table',
    identical: 'mcp_servers.alpha = { command = "node", args = ["./alpha.mjs"] }\n',
    different: 'mcp_servers.alpha = { command = "python" }\n',
  },
  {
    form: 'an inline table under [mcp_servers]',
    identical: '[mcp_servers]\nalpha = { command = "node", args = ["./alpha.mjs"] }\n',
    different: '[mcp_servers]\nalpha = { command = "python" }\n',
  },
  {
    form: 'dotted keys under [mcp_servers]',
    identical: '[mcp_servers]\nalpha.command = "node"\nalpha.args = [\n  "./alpha.mjs",\n]\n',
    different: '[mcp_servers]\nalpha.command = "python"\n',
  },
  {
    form: 'root dotted keys',
    identical: 'mcp_servers.alpha.command = "node"\nmcp_servers.alpha.args = ["./alpha.mjs"]\n',
    different: 'mcp_servers.alpha.command = "python"\n',
  },
];

for (const { form, identical, different } of UNMANAGED_FORMS) {
  test(`an unmanaged Codex server written as ${form} is a conflict when it differs`, async () => {
    const root = await createTarget(ALPHA_ONLY);
    const original = `${different}\n[profiles.mine]\nmodel = "other"\n`;
    await write(root, CODEX, original);

    const result = drakom('sync', root);

    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /CONFLICT \.codex\/config\.toml.*would replace an existing unmanaged MCP server "alpha"/);
    assert.equal(await read(root, CODEX), original);
  });

  test(`an identical unmanaged Codex server written as ${form} is adopted without a duplicate`, async () => {
    const root = await createTarget(ALPHA_ONLY);
    await write(root, CODEX, `model = "example"\n${identical}\n[profiles.mine]\nmodel = "other"\n`);

    const result = syncOk(root);

    assert.doesNotMatch(result.stdout, /^CONFLICT/m);
    const text = await read(root, CODEX);
    const parsed = parseToml(text);
    assert.deepEqual(parsed.mcp_servers, { alpha: { command: 'node', args: ['./alpha.mjs'] } });
    assert.equal(parsed.model, 'example');
    assert.deepEqual(parsed.profiles, { mine: { model: 'other' } });
    assert.equal(count(text, 'alpha'), 2, text);
    assert.ok(text.includes(`${BLOCK_START}\n${ALPHA_TABLE}`), text);
    assert.ok((await readState(root)).managedMcpServers.alpha.targetFingerprints[CODEX]);
    assertInSync(root);
  });
}

test('adopting one inline server keeps its unmanaged neighbours as written', async () => {
  const root = await createTarget(ALPHA_ONLY);
  await write(
    root,
    CODEX,
    '[mcp_servers]\n# mine\nother = { command = "keep" }\nalpha = { command = "node", args = ["./alpha.mjs"] }\nlast.command = "also"\n',
  );

  syncOk(root);

  const text = await read(root, CODEX);
  assert.ok(text.startsWith('[mcp_servers]\n# mine\nother = { command = "keep" }\nlast.command = "also"\n'), text);
  assert.deepEqual(Object.keys(parseToml(text).mcp_servers).sort(), ['alpha', 'last', 'other']);
  assertInSync(root);
});

test('an identical server inside a whole-table inline mcp_servers is refused rather than duplicated', async () => {
  const root = await createTarget(ALPHA_ONLY);
  const original = 'mcp_servers = { alpha = { command = "node", args = ["./alpha.mjs"] }, other = { command = "keep" } }\n';
  await write(root, CODEX, original);

  const result = drakom('sync', root);

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /CONFLICT \.codex\/config\.toml.*"alpha".*\[mcp_servers\.alpha\]/);
  assert.equal(await read(root, CODEX), original);
});

test('a server the kit manages that is also defined outside the block is a conflict, not a duplicate', async () => {
  const root = await createTarget(ALPHA_ONLY);
  syncOk(root);
  const managed = await read(root, CODEX);
  const edited = `[mcp_servers]\nalpha.startup_timeout_sec = 20\n\n${managed}`;
  await write(root, CODEX, edited);
  await write(root, REGISTRY, ALPHA_ONLY.replace('./alpha.mjs', './changed.mjs'));

  const result = drakom('sync', root);

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /CONFLICT \.codex\/config\.toml/);
  assert.equal(await read(root, CODEX), edited);
});

test('removeCodexServerFromToml removes every form and keeps the other lines byte for byte', () => {
  const text = [
    'model = "example"\r\n',
    'mcp_servers.alpha.command = "node"\r\n',
    '# kept comment\r\n',
    '[mcp_servers]\r\n',
    'alpha.args = [\r\n',
    '  "./alpha.mjs", # ] not the end\r\n',
    ']\r\n',
    'other = { command = "keep" }\r\n',
    '\r\n',
    '[mcp_servers."alpha".env]\r\n',
    'A = """\r\n',
    '[not.a.header]\r\n',
    '"""\r\n',
    '\r\n',
    '# belongs to the next table\r\n',
    '[profiles.mine]\r\n',
    'model = "other"\r\n',
  ].join('');

  const removed = removeCodexServerFromToml(text, 'alpha');

  assert.equal(
    removed,
    [
      'model = "example"\r\n',
      '# kept comment\r\n',
      '[mcp_servers]\r\n',
      'other = { command = "keep" }\r\n',
      '\r\n',
      '# belongs to the next table\r\n',
      '[profiles.mine]\r\n',
      'model = "other"\r\n',
    ].join(''),
  );
  assert.deepEqual(parseToml(removed), { model: 'example', mcp_servers: { other: { command: 'keep' } }, profiles: { mine: { model: 'other' } } });
});

test('removeCodexServerFromToml leaves a server it cannot cut out and a similarly named one', () => {
  const nested = 'mcp_servers = { alpha = { command = "node" }, other = { command = "keep" } }\n';
  assert.equal(removeCodexServerFromToml(nested, 'alpha'), nested);
  const similar = '[mcp_servers.alpha-two]\ncommand = "node"\n\n[mcp_servers."alpha.two"]\ncommand = "node"\n';
  assert.equal(removeCodexServerFromToml(similar, 'alpha'), similar);
});

// ---------------------------------------------------------------------------
// Codex: the "AI Framework Blueprint" markers are no longer a managed block
// ---------------------------------------------------------------------------

const LEGACY_START = '# BEGIN AI Framework Blueprint MCP servers';
const LEGACY_END = '# END AI Framework Blueprint MCP servers';

test('servers between legacy Blueprint markers are kept as unmanaged content', async () => {
  const root = await createTarget(ALPHA_ONLY);
  const legacy = `model = "example"\n\n${LEGACY_START}\n[mcp_servers.legacy]\ncommand = "node"\nargs = ["legacy.js"]\n${LEGACY_END}\n`;
  await write(root, CODEX, legacy);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^(CONFLICT|WARNING)/m);
  const text = await read(root, CODEX);
  assert.equal(text, `${legacy.trimEnd()}\n\n${BLOCK_START}\n${ALPHA_TABLE}\n${BLOCK_END}\n`);
  assert.deepEqual(Object.keys(parseToml(text).mcp_servers), ['legacy', 'alpha']);
  assertInSync(root);
});

test('a different same-name server between legacy Blueprint markers is a conflict', async () => {
  const root = await createTarget(ALPHA_ONLY);
  const legacy = `${LEGACY_START}\n[mcp_servers.alpha]\ncommand = "python"\n${LEGACY_END}\n`;
  await write(root, CODEX, legacy);

  const result = drakom('sync', root);

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /CONFLICT \.codex\/config\.toml.*would replace an existing unmanaged MCP server "alpha"/);
  assert.equal(await read(root, CODEX), legacy);
});

test('a recorded server left between legacy Blueprint markers moves into the managed block once', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  const current = await read(root, CODEX);
  // The same tables as an old version left them: recorded in state, under the old markers.
  await write(root, CODEX, `model = "example"\n\n${current.replace(BLOCK_START, LEGACY_START).replace(BLOCK_END, LEGACY_END)}`);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^CONFLICT/m);
  const text = await read(root, CODEX);
  const parsed = parseToml(text);
  assert.deepEqual(parsed.mcp_servers, {
    alpha: { command: 'node', args: ['./alpha.mjs'] },
    beta: { command: 'node', args: ['./beta.mjs'] },
  });
  assert.equal(parsed.model, 'example');
  assert.equal(count(text, '[mcp_servers.alpha]'), 1);
  assert.ok(text.indexOf(BLOCK_START) < text.indexOf('[mcp_servers.alpha]'));
  assert.ok(text.includes(LEGACY_START) && text.includes(LEGACY_END), 'the old marker comments are user content now');
  assertInSync(root);
});

test('a recorded server edited between legacy Blueprint markers is a conflict', async () => {
  const root = await createTarget(ALPHA_ONLY);
  syncOk(root);
  const current = await read(root, CODEX);
  const legacy = current.replace(BLOCK_START, LEGACY_START).replace(BLOCK_END, LEGACY_END).replace('./alpha.mjs', './edited.mjs');
  await write(root, CODEX, legacy);

  const result = drakom('sync', root);

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /CONFLICT \.codex\/config\.toml.*"alpha".*outside the managed block/);
  assert.equal(await read(root, CODEX), legacy);
});


// ---------------------------------------------------------------------------
// Codex: block markers are whole comment lines
// ---------------------------------------------------------------------------

test('marker text inside a TOML string is not a managed block', async () => {
  const root = await createTarget(ALPHA_ONLY);
  const original = `notes = """\n${BLOCK_START}\n"""\ninline = "see ${BLOCK_END}"\n`;
  await write(root, CODEX, original);

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /malformed/);
  const text = await read(root, CODEX);
  assert.equal(text, `${original}\n${BLOCK_START}\n${ALPHA_TABLE}\n${BLOCK_END}\n`);
  assert.equal(parseToml(text).notes, `${BLOCK_START}\n`);
  assertInSync(root);
});

test('marker text in a string before a real block leaves the real block to be rewritten in place', async () => {
  const root = await createTarget(ALPHA_ONLY);
  syncOk(root);
  const block = await read(root, CODEX);
  const before = `notes = """\n${BLOCK_END}\n${BLOCK_START}\n"""\n\n`;
  const after = '\n[profiles.mine]\nmodel = "other"\n';
  await write(root, CODEX, `${before}${block}${after}`);
  await write(root, REGISTRY, ALPHA_ONLY.replace('./alpha.mjs', './changed.mjs'));

  syncOk(root);

  assert.equal(await read(root, CODEX), `${before}${block.replace('./alpha.mjs', './changed.mjs')}${after}`);
  assertInSync(root);
});

test('indented markers with CRLF endings are still found', async () => {
  const root = await createTarget(ALPHA_ONLY);
  await write(root, CODEX, `model = "x"\r\n\r\n  ${BLOCK_START}\r\n[mcp_servers.alpha]\r\ncommand = "node"\r\nargs = ["./alpha.mjs"]\r\n  ${BLOCK_END}  \r\n`);

  syncOk(root);

  const text = await read(root, CODEX);
  assert.equal(count(text, '[mcp_servers.alpha]'), 1, text);
  assertOnlyCrlf(text);
  assertInSync(root);
});

// ---------------------------------------------------------------------------
// Codex: what follows the managed block
// ---------------------------------------------------------------------------

test('loose keys directly after the managed block are a conflict that names the first one', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  const edited = `${await read(root, CODEX)}\n# my note\nstartup_timeout_sec = 20\n\n[profiles.mine]\nmodel = "other"\n`;
  await write(root, CODEX, edited);
  await write(root, REGISTRY, ALPHA_ONLY);

  const result = drakom('sync', root);

  assert.equal(result.status, 2, result.stdout);
  assert.match(
    result.stdout,
    /CONFLICT \.codex\/config\.toml.*after the managed block must start with a table header.*"startup_timeout_sec = 20"/,
  );
  assert.equal(await read(root, CODEX), edited);
});

test('comments and blank lines after the managed block are fine before a table header', async () => {
  const root = await createTarget(TWO_SERVERS);
  syncOk(root);
  const block = await read(root, CODEX);
  const after = '\n# my note\n\n   # indented note\n[profiles.mine]\nmodel = "other"\n';
  await write(root, CODEX, `${block}${after}`);
  await write(root, REGISTRY, ALPHA_ONLY);

  syncOk(root);

  assert.equal(await read(root, CODEX), `${BLOCK_START}\n${ALPHA_TABLE}\n${BLOCK_END}\n${after}`);
  assertInSync(root);
});

test('a sub-table the user adds to a managed server outside the block is a conflict', async () => {
  const root = await createTarget(ALPHA_ONLY);
  syncOk(root);
  const edited = `${await read(root, CODEX)}\n[mcp_servers.alpha.env]\nMINE = "1"\n`;
  await write(root, CODEX, edited);
  await write(root, REGISTRY, ALPHA_ONLY.replace('./alpha.mjs', './changed.mjs'));

  const result = drakom('sync', root);

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /CONFLICT \.codex\/config\.toml.*"alpha" is defined outside the managed block/);
  assert.equal(await read(root, CODEX), edited);
});

test('a Codex entry edited by hand to exactly what the registry now generates is not a conflict', async () => {
  const root = await createTarget(ALPHA_ONLY);
  syncOk(root);
  const edited = (await read(root, CODEX)).replace('./alpha.mjs', './changed.mjs');
  await write(root, CODEX, edited);
  await write(root, REGISTRY, ALPHA_ONLY.replace('./alpha.mjs', './changed.mjs'));

  const result = syncOk(root);

  assert.doesNotMatch(result.stdout, /^CONFLICT/m);
  assert.equal(await read(root, CODEX), edited);
  assertInSync(root);
});
