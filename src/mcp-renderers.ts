import type { BaseServerConfig, ClientOverrideConfig, McpClient, StringMap } from './mcp-types.js';
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

function resolveServerConfig(server: BaseServerConfig, client: McpClient): ClientOverrideConfig {
  const override = server.overrides?.[client];
  if (!override) {
    const result: ClientOverrideConfig = {};
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
    const result: ClientOverrideConfig = {};
    const command = override.command ?? server.command;
    if (command) result.command = command;
    const args = override.args ?? server.args;
    if (args) result.args = args;
    if (server.env || override.env) result.env = { ...(server.env ?? {}), ...(override.env ?? {}) };
    return result;
  }

  const url = overrideUrl ?? server.http?.url;
  const type = override.http?.type ?? override.type ?? override.transport ?? server.http?.type;
  const headers = { ...(server.http?.headers ?? {}), ...(override.http?.headers ?? {}), ...(override.headers ?? {}) };
  const result: ClientOverrideConfig = {};
  if (url) {
    result.url = url;
    result.serverUrl = url;
    result.http = { url, ...(type ? { type } : {}), ...(Object.keys(headers).length > 0 ? { headers } : {}) };
  }
  if (type) {
    result.type = type;
    result.transport = type;
  }
  if (Object.keys(headers).length > 0) result.headers = headers;
  if (override.timeout !== undefined) result.timeout = override.timeout;
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

// `${input:...}` prompts are a VS Code feature; other clients would receive the literal text.
function assertNoVscodeInput(value: string, field: string): void {
  const input = value.match(INPUT_REF_REGEX)?.[0];
  if (input) throw new Error(`${field} uses ${input}, which only VS Code supports; move it into overrides.vscode`);
}

function assertNoUnsupportedVarRef(value: string, client: 'Codex' | 'Antigravity', field: string): void {
  assertNoVscodeInput(value, field);
  const match = value.match(VAR_REFS_REGEX)?.[0];
  if (match) {
    const remedy = client === 'Codex'
      ? field.startsWith('args') || field.startsWith('env.')
        ? 'pass the value through env or use overrides.codex'
        : 'use a fixed value in overrides.codex'
      : 'use a reference-free overrides.antigravity configuration or leave the server unmanaged';
    throw new Error(`${client} ${field} uses ${match}, which ${client} cannot expand; ${remedy}`);
  }
}

// Claude Code expands `${VAR}`; VS Code expands `${env:VAR}` (code.visualstudio.com/docs/reference/variables-reference).
function translateVarRefs(value: string, client: 'claude' | 'vscode', field: string): string {
  if (client !== 'vscode') assertNoVscodeInput(value, field);
  return value.replace(VAR_REFS_REGEX, (_match, bracedName: string | undefined, bareName: string | undefined) =>
    clientVarFormats[client](bracedName ?? bareName ?? ''),
  );
}

function translateStringMap(map: StringMap | undefined, client: 'claude' | 'vscode', field: string): StringMap | undefined {
  if (!map) return map;
  const translated: StringMap = {};
  for (const [key, value] of Object.entries(map)) {
    translated[key] = translateVarRefs(value, client, `${field}.${key}`);
  }
  return translated;
}

const clientVarFormats: Record<'claude' | 'vscode', (name: string) => string> = {
  claude: (name) => `\${${name}}`,
  vscode: (name) => `\${env:${name}}`,
};

function generateJsonServer(server: BaseServerConfig, client: 'claude' | 'vscode'): Record<string, unknown> {
  const resolved = resolveServerConfig(server, client);
  const rawUrl = resolved.http?.url ?? resolved.url;
  const url = rawUrl ? translateVarRefs(rawUrl, client, 'url') : undefined;
  const rawHeaders = resolved.http?.headers ?? resolved.headers;
  const headers = translateStringMap(rawHeaders, client, 'headers');
  const env = translateStringMap(resolved.env, client, 'env');
  if (url) {
    return {
      type: resolved.http?.type ?? resolved.type ?? 'http',
      url,
      ...(hasEntries(headers) ? { headers } : {}),
    };
  }
  return {
    ...(client === 'vscode' ? { type: 'stdio' } : {}),
    ...(resolved.command ? { command: translateVarRefs(resolved.command, client, 'command') } : {}),
    ...(resolved.args ? { args: resolved.args.map((arg, index) => translateVarRefs(arg, client, `args[${index}]`)) } : {}),
    ...(hasEntries(env) ? { env } : {}),
  };
}

export function generateClaudeServer(server: BaseServerConfig): Record<string, unknown> {
  return generateJsonServer(server, 'claude');
}

export function generateVscodeServer(server: BaseServerConfig): Record<string, unknown> {
  return generateJsonServer(server, 'vscode');
}

export function generateAntigravityServer(server: BaseServerConfig): Record<string, unknown> {
  const resolved = resolveServerConfig(server, 'antigravity');
  const url = resolved.serverUrl ?? resolved.http?.url ?? resolved.url;
  if (url) {
    assertNoUnsupportedVarRef(url, 'Antigravity', 'url');
    const transport = resolved.transport ?? resolved.http?.type ?? resolved.type;
    const headers = resolved.headers ?? resolved.http?.headers;
    for (const [key, value] of Object.entries(headers ?? {})) assertNoUnsupportedVarRef(value, 'Antigravity', `headers.${key}`);
    return {
      serverUrl: url,
      ...(transport ? { transport } : {}),
      ...(resolved.timeout !== undefined ? { timeout: resolved.timeout } : {}),
      ...(hasEntries(headers) ? { headers } : {}),
    };
  }
  if (resolved.command) assertNoUnsupportedVarRef(resolved.command, 'Antigravity', 'command');
  for (const [index, arg] of (resolved.args ?? []).entries()) assertNoUnsupportedVarRef(arg, 'Antigravity', `args[${index}]`);
  for (const [key, value] of Object.entries(resolved.env ?? {})) assertNoUnsupportedVarRef(value, 'Antigravity', `env.${key}`);
  return {
    ...(resolved.command ? { command: resolved.command } : {}),
    ...(resolved.args ? { args: resolved.args } : {}),
    ...(hasEntries(resolved.env) ? { env: resolved.env } : {}),
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
            `Codex cannot rename environment variables: server "${name}" sets ${key} from $${varName}; use a variable named ${key}.`,
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
