import type { BaseServerConfig, HttpConfig, McpClient, RemovableStringMap, StringMap } from './mcp-types.js';
import { fingerprint, isRecord } from './util.js';
import { INPUT_REF_REGEX, VAR_REF_REGEX, VAR_REFS_REGEX } from './mcp-variables.js';

export function sortKeys<T>(obj: T): T {
  if (!isRecord(obj)) return obj;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const value = obj[key];
    sorted[key] = isRecord(value) ? sortKeys(value) : value;
  }
  return sorted as T;
}

export function fingerprintObject(obj: unknown): string {
  return fingerprint(JSON.stringify(sortKeys(obj)));
}

function hasEntries(value: StringMap | undefined): value is StringMap {
  return value !== undefined && Object.keys(value).length > 0;
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined;
}

/** A server as one client sees it: the base definition with that client's override applied. */
interface ResolvedServerConfig {
  command?: string;
  args?: string[];
  env?: StringMap;
  http?: HttpConfig;
  url?: string;
  serverUrl?: string;
  type?: string;
  headers?: StringMap;
  timeoutSeconds?: number;
}

/**
 * Lays override maps over a base map, in order. A `null` layer drops everything gathered so far;
 * a `null` value drops that key.
 */
function mergeStringMaps(base: StringMap | undefined, ...layers: Array<RemovableStringMap | null | undefined>): StringMap {
  let merged: StringMap = { ...(base ?? {}) };
  for (const layer of layers) {
    if (layer === undefined) continue;
    if (layer === null) {
      merged = {};
      continue;
    }
    for (const [key, value] of Object.entries(layer)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
  }
  return merged;
}

function resolveServerConfig(server: BaseServerConfig, client: McpClient): ResolvedServerConfig {
  const override = server.overrides?.[client];
  if (!override) {
    const result: ResolvedServerConfig = {};
    if (server.command) result.command = server.command;
    if (server.args) result.args = server.args;
    if (server.env) result.env = server.env;
    if (server.http) result.http = server.http;
    return result;
  }

  const overrideCommand = nonEmptyString(override.command);
  const overrideUrl = nonEmptyString(override.http?.url) ?? nonEmptyString(override.url) ?? nonEmptyString(override.serverUrl);
  const isStdio = overrideCommand !== undefined || (server.command !== undefined && overrideUrl === undefined);

  if (isStdio) {
    const result: ResolvedServerConfig = {};
    const command = override.command ?? server.command;
    if (command) result.command = command;
    const args = override.args ?? server.args;
    if (args) result.args = args;
    if (server.env || override.env) result.env = mergeStringMaps(server.env, override.env);
    if (override.timeoutSeconds !== undefined) result.timeoutSeconds = override.timeoutSeconds;
    return result;
  }

  const url = overrideUrl ?? server.http?.url;
  const type = override.http?.type ?? override.type ?? override.transport ?? server.http?.type;
  const headers = mergeStringMaps(server.http?.headers, override.http?.headers, override.headers);
  const result: ResolvedServerConfig = {};
  if (url) {
    result.url = url;
    result.serverUrl = url;
    result.http = { url, ...(type ? { type } : {}), ...(Object.keys(headers).length > 0 ? { headers } : {}) };
  }
  if (type) result.type = type;
  if (Object.keys(headers).length > 0) result.headers = headers;
  if (override.timeoutSeconds !== undefined) result.timeoutSeconds = override.timeoutSeconds;
  return result;
}

const BEARER_PREFIX_REGEX = /^(Bearer\s+)(.+)$/i;

function varRefName(value: string): string | undefined {
  const match = value.match(VAR_REF_REGEX);
  return match ? (match[1] ?? match[2]) : undefined;
}

function bearerVarRefName(value: string): string | undefined {
  const match = value.match(BEARER_PREFIX_REGEX);
  return match?.[2] === undefined ? undefined : varRefName(match[2]);
}

/** A `${input:...}` prompt met where it cannot be written. */
export class VscodeInputError extends Error {
  readonly input: string;

  constructor(field: string, input: string, client: McpClient) {
    super(`${field} uses ${input}, which only VS Code supports; move it into overrides.vscode, or add "skip: [${client}]" to the server`);
    this.input = input;
  }
}

// `${input:...}` prompts are a VS Code feature; other clients would receive the literal text.
function assertNoVscodeInput(value: string, field: string, client: McpClient): void {
  const input = value.match(INPUT_REF_REGEX)?.[0];
  if (input) throw new VscodeInputError(field, input, client);
}

function assertNoUnsupportedVarRef(value: string, client: 'Codex' | 'Antigravity', field: string): void {
  assertNoVscodeInput(value, field, client === 'Codex' ? 'codex' : 'antigravity');
  const match = value.match(VAR_REFS_REGEX)?.[0];
  if (match) {
    const remedy = client === 'Codex'
      ? field.startsWith('args') || field.startsWith('env.')
        ? 'pass the value through env, use overrides.codex, or add "skip: [codex]" to the server'
        : 'use a fixed value in overrides.codex, or add "skip: [codex]" to the server'
      : field.startsWith('env.') || field.startsWith('headers.')
        ? `add "skip: [antigravity]" to the server, or set overrides.antigravity.${field} to null to leave the field out for Antigravity`
        : 'add "skip: [antigravity]" to the server, or give Antigravity a fixed value in overrides.antigravity';
    throw new Error(`${client} ${field} uses ${match}, which ${client} cannot expand; ${remedy}`);
  }
}

/** The two JSON notations: the root `.mcp.json` takes `${VAR}`, `.vscode/mcp.json` takes `${env:VAR}`. */
type JsonFormat = 'root' | 'vscode';

const varFormats: Record<JsonFormat, (name: string) => string> = {
  root: (name) => `\${${name}}`,
  vscode: (name) => `\${env:${name}}`,
};

/** One JSON rendering: whose override applies (and who a refusal names), and the notation written. */
interface JsonRendering {
  client: 'claude' | 'vscode';
  format: JsonFormat;
}

// Claude Code expands `${VAR}`; VS Code expands `${env:VAR}` (code.visualstudio.com/docs/reference/variables-reference).
function translateVarRefs(value: string, rendering: JsonRendering, field: string): string {
  if (rendering.format !== 'vscode') assertNoVscodeInput(value, field, rendering.client);
  return value.replace(VAR_REFS_REGEX, (_match, bracedName: string | undefined, bareName: string | undefined) =>
    varFormats[rendering.format](bracedName ?? bareName ?? ''),
  );
}

function translateStringMap(map: StringMap | undefined, rendering: JsonRendering, field: string): StringMap | undefined {
  if (!map) return map;
  const translated: StringMap = {};
  for (const [key, value] of Object.entries(map)) {
    translated[key] = translateVarRefs(value, rendering, `${field}.${key}`);
  }
  return translated;
}

function generateJsonServer(server: BaseServerConfig, rendering: JsonRendering): Record<string, unknown> {
  const resolved = resolveServerConfig(server, rendering.client);
  const rawUrl = resolved.http?.url ?? resolved.url;
  const url = rawUrl ? translateVarRefs(rawUrl, rendering, 'url') : undefined;
  const rawHeaders = resolved.http?.headers ?? resolved.headers;
  const headers = translateStringMap(rawHeaders, rendering, 'headers');
  const env = translateStringMap(resolved.env, rendering, 'env');
  if (url) {
    return {
      type: resolved.http?.type ?? resolved.type ?? 'http',
      url,
      ...(hasEntries(headers) ? { headers } : {}),
    };
  }
  return {
    ...(rendering.format === 'vscode' ? { type: 'stdio' } : {}),
    ...(resolved.command ? { command: translateVarRefs(resolved.command, rendering, 'command') } : {}),
    ...(resolved.args ? { args: resolved.args.map((arg, index) => translateVarRefs(arg, rendering, `args[${index}]`)) } : {}),
    ...(hasEntries(env) ? { env } : {}),
  };
}

export function generateClaudeServer(server: BaseServerConfig): Record<string, unknown> {
  return generateJsonServer(server, { client: 'claude', format: 'root' });
}

export function generateVscodeServer(server: BaseServerConfig): Record<string, unknown> {
  return generateJsonServer(server, { client: 'vscode', format: 'vscode' });
}

/**
 * The server as VS Code is to have it, written for the root `.mcp.json`: the vscode override
 * applies, in the root file's notation. Throws a VscodeInputError for a `${input:...}` prompt,
 * which that file cannot express.
 */
export function generateVscodeRootServer(server: BaseServerConfig): Record<string, unknown> {
  return generateJsonServer(server, { client: 'vscode', format: 'root' });
}

/** Override keys that earlier releases passed through to Antigravity, whose configuration does not define them. */
const ANTIGRAVITY_IGNORED_OVERRIDE_KEYS = ['type', 'transport', 'timeout'] as const;

/** The keys of `overrides.antigravity` that are accepted and not written. */
export function ignoredAntigravityOverrideKeys(server: BaseServerConfig): string[] {
  const override = server.overrides?.antigravity;
  if (!override) return [];
  return ANTIGRAVITY_IGNORED_OVERRIDE_KEYS.filter((key) => override[key] !== undefined);
}

// Fields as documented at antigravity.google/docs/mcp: `serverUrl` for a remote server (Streamable
// HTTP only, with no field naming the transport) and `timeoutSeconds` for either kind of server.
export function generateAntigravityServer(server: BaseServerConfig): Record<string, unknown> {
  const resolved = resolveServerConfig(server, 'antigravity');
  const timeout = resolved.timeoutSeconds !== undefined ? { timeoutSeconds: resolved.timeoutSeconds } : {};
  const url = resolved.serverUrl ?? resolved.http?.url ?? resolved.url;
  if (url) {
    assertNoUnsupportedVarRef(url, 'Antigravity', 'url');
    const headers = resolved.headers ?? resolved.http?.headers;
    for (const [key, value] of Object.entries(headers ?? {})) assertNoUnsupportedVarRef(value, 'Antigravity', `headers.${key}`);
    return {
      serverUrl: url,
      ...(hasEntries(headers) ? { headers } : {}),
      ...timeout,
    };
  }
  if (resolved.command) assertNoUnsupportedVarRef(resolved.command, 'Antigravity', 'command');
  for (const [index, arg] of (resolved.args ?? []).entries()) assertNoUnsupportedVarRef(arg, 'Antigravity', `args[${index}]`);
  for (const [key, value] of Object.entries(resolved.env ?? {})) assertNoUnsupportedVarRef(value, 'Antigravity', `env.${key}`);
  return {
    ...(resolved.command ? { command: resolved.command } : {}),
    ...(resolved.args ? { args: resolved.args } : {}),
    ...(hasEntries(resolved.env) ? { env: resolved.env } : {}),
    ...timeout,
  };
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

// Codex does not expand `${VAR}` in `env`; `env_vars` forwards a variable under its own name only.
function splitCodexEnv(name: string, env: StringMap | undefined): { literalEnv: StringMap; envVars: string[] } {
  const literalEnv: StringMap = {};
  const envVars: string[] = [];
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      const varName = varRefName(value);
      if (varName !== undefined) {
        if (varName !== key) {
          throw new Error(
            `Codex cannot rename environment variables: server "${name}" sets ${key} from $${varName}; use a variable named ${key}, or add "skip: [codex]" to the server.`,
          );
        }
        envVars.push(key);
      } else {
        assertNoUnsupportedVarRef(value, 'Codex', `env.${key}`);
        literalEnv[key] = value;
      }
    }
  }
  return { literalEnv, envVars };
}

// Codex reads header secrets from the environment via bearer_token_env_var and env_http_headers.
function splitCodexHeaders(headers: StringMap | undefined): {
  bearerTokenVar: string | undefined;
  envHeaders: StringMap;
  literalHeaders: StringMap;
} {
  let bearerTokenVar: string | undefined;
  const envHeaders: StringMap = {};
  const literalHeaders: StringMap = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const bearerName = key.toLowerCase() === 'authorization' ? bearerVarRefName(value) : undefined;
    const varName = varRefName(value);
    if (bearerName !== undefined) {
      bearerTokenVar = bearerName;
    } else if (varName !== undefined) {
      envHeaders[key] = varName;
    } else {
      assertNoUnsupportedVarRef(value, 'Codex', `headers.${key}`);
      literalHeaders[key] = value;
    }
  }
  return { bearerTokenVar, envHeaders, literalHeaders };
}

export function generateCodexServerSnippet(name: string, server: BaseServerConfig): string {
  const resolved = resolveServerConfig(server, 'codex');
  const serverTable = `mcp_servers.${tomlKey(name)}`;
  const lines = [`[${serverTable}]`];
  if (resolved.command) {
    assertNoUnsupportedVarRef(resolved.command, 'Codex', 'command');
    lines.push(`command = ${JSON.stringify(resolved.command)}`);
  }
  if (resolved.args) {
    for (const [index, arg] of resolved.args.entries()) assertNoUnsupportedVarRef(arg, 'Codex', `args[${index}]`);
    lines.push(`args = ${JSON.stringify(resolved.args)}`);
  }
  const url = resolved.http?.url ?? resolved.url ?? resolved.serverUrl;
  if (url) {
    assertNoUnsupportedVarRef(url, 'Codex', 'url');
    lines.push(`url = ${JSON.stringify(url)}`);
  }
  const { literalEnv, envVars } = splitCodexEnv(name, resolved.env);
  if (envVars.length > 0) lines.push(`env_vars = ${JSON.stringify(envVars)}`);
  const { bearerTokenVar, envHeaders, literalHeaders } = splitCodexHeaders(resolved.http?.headers ?? resolved.headers);
  if (bearerTokenVar) lines.push(`bearer_token_env_var = ${JSON.stringify(bearerTokenVar)}`);
  if (hasEntries(literalEnv)) {
    lines.push('', `[${serverTable}.env]`);
    for (const [key, value] of Object.entries(literalEnv)) lines.push(`${tomlKey(key)} = ${JSON.stringify(value)}`);
  }
  if (hasEntries(literalHeaders)) {
    lines.push('', `[${serverTable}.http_headers]`);
    for (const [key, value] of Object.entries(literalHeaders)) lines.push(`${tomlKey(key)} = ${JSON.stringify(value)}`);
  }
  if (hasEntries(envHeaders)) {
    lines.push('', `[${serverTable}.env_http_headers]`);
    for (const [key, value] of Object.entries(envHeaders)) lines.push(`${tomlKey(key)} = ${JSON.stringify(value)}`);
  }
  return `${lines.join('\n')}\n`;
}
