import { load as loadYaml, dump as dumpYaml } from 'js-yaml';
import { parse as parseToml } from 'smol-toml';
import { isDeepStrictEqual } from 'node:util';

import type { TargetInventory } from './inspect-target.js';
import { DRAKOM_DIR } from './constants.js';
import type {
  BaseServerConfig,
  ClientOverrideConfig,
  DiscoveredMcpConfiguration,
  DiscoveredServerClientEntry,
  DiscoveredServerSummary,
  McpClassification,
  McpImportChoice,
  McpRegistry,
  NormalizedHttpServer,
  NormalizedServer,
  NormalizedStdioServer,
  StringMap,
} from './mcp-types.js';

type NormalizationResult = {
  normalized?: NormalizedServer;
  isUnsupported: boolean;
  unsupportedReason?: string;
};

type ClientName = DiscoveredServerClientEntry['client'];

interface HeaderSource {
  field: string;
  ignoreInvalid?: boolean;
}
interface ClientNormalization {
  urlFields: readonly string[];
  missingTransportReason: string;
  bothTransportReason: string;
  headerSources: readonly HeaderSource[];
  httpType: (raw: Record<string, unknown>) => string;
}

interface ClientFileSpec {
  filePath: string;
  client: ClientName;
  serverKey: string;
  topLevelError: string;
  serverMappingError: string;
  syntaxError: string;
  parse: (content: string) => unknown;
  normalization: ClientNormalization;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is StringMap {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

const SENSITIVE_KEY_REGEX =
  /^(.*_)?(API_KEY|APIKEY|SECRET|TOKEN|PASSWORD|PASSWD|AUTH|CREDENTIALS?|JWT|PRIVATE_KEY)(_.*)?$/i;

const SENSITIVE_HEADER_REGEX =
  /^(authorization|api-key|x-api-key|token|auth|x-auth-token)$/i;

const VARIABLE_REF_REGEX = /^\$\{?[A-Za-z0-9_]+\}?$/;
const BEARER_VAR_REGEX = /^Bearer\s+\$\{?[A-Za-z0-9_]+\}?$/i;

const TOKEN_PATTERN_REGEX =
  /(?:sk-[a-zA-Z0-9_-]{10,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}|glpat-[a-zA-Z0-9_-]{20,}|xox[baprs]-[a-zA-Z0-9_-]{10,})/;

export function checkLiteralCredentials(
  raw: unknown,
  prefix = '',
): { hasCredentials: boolean; field?: string } {
  if (!isRecord(raw)) return { hasCredentials: false };

  // 1. Check env
  if (isRecord(raw.env)) {
    for (const [key, val] of Object.entries(raw.env)) {
      if (typeof val === 'string' && val.length > 0) {
        if (SENSITIVE_KEY_REGEX.test(key) && !VARIABLE_REF_REGEX.test(val)) {
          return { hasCredentials: true, field: `${prefix}env.${key}` };
        }
        if (TOKEN_PATTERN_REGEX.test(val) && !VARIABLE_REF_REGEX.test(val)) {
          return { hasCredentials: true, field: `${prefix}env.${key}` };
        }
      }
    }
  }

  // 2. Check headers
  const headers = isRecord(raw.headers)
    ? raw.headers
    : isRecord(raw.http) && isRecord(raw.http.headers)
      ? raw.http.headers
      : isRecord(raw.http_headers)
        ? raw.http_headers
        : null;

  if (headers) {
    for (const [key, val] of Object.entries(headers)) {
      if (typeof val === 'string' && val.length > 0) {
        if (SENSITIVE_HEADER_REGEX.test(key)) {
          if (!VARIABLE_REF_REGEX.test(val) && !BEARER_VAR_REGEX.test(val)) {
            return { hasCredentials: true, field: `${prefix}headers.${key}` };
          }
        }
        if (TOKEN_PATTERN_REGEX.test(val) && !VARIABLE_REF_REGEX.test(val)) {
          return { hasCredentials: true, field: `${prefix}headers.${key}` };
        }
      }
    }
  }

  // 3. Check URL
  const rawUrl =
    typeof raw.url === 'string'
      ? raw.url
      : typeof raw.serverUrl === 'string'
        ? raw.serverUrl
        : isRecord(raw.http) && typeof raw.http.url === 'string'
          ? raw.http.url
          : null;

  if (rawUrl) {
    try {
      const parsedUrl = new URL(rawUrl);
      if (parsedUrl.username || parsedUrl.password) {
        return { hasCredentials: true, field: `${prefix}url.userinfo` };
      }
      for (const [paramName, paramVal] of parsedUrl.searchParams) {
        if (
          SENSITIVE_KEY_REGEX.test(paramName) &&
          !VARIABLE_REF_REGEX.test(paramVal)
        ) {
          return { hasCredentials: true, field: `${prefix}url.param.${paramName}` };
        }
      }
    } catch {
      // Not a standard URL or template
    }
  }

  // 4. Check args
  if (Array.isArray(raw.args)) {
    for (let i = 0; i < raw.args.length; i++) {
      const arg = raw.args[i];
      if (typeof arg === 'string') {
        const match = arg.match(/(?:token|secret|password|api[_-]?key)=([^\s]+)/i);
        if (match && match[1] && !VARIABLE_REF_REGEX.test(match[1])) {
          return { hasCredentials: true, field: `${prefix}args[${i}]` };
        }
        if (TOKEN_PATTERN_REGEX.test(arg) && !VARIABLE_REF_REGEX.test(arg)) {
          return { hasCredentials: true, field: `${prefix}args[${i}]` };
        }
      }
    }
  }

  // 5. Check overrides recursively
  if (isRecord(raw.overrides)) {
    for (const [tool, overrideConfig] of Object.entries(raw.overrides)) {
      const overrideCred = checkLiteralCredentials(overrideConfig, `${prefix}overrides.${tool}.`);
      if (overrideCred.hasCredentials) {
        return overrideCred;
      }
    }
  }

  return { hasCredentials: false };
}


function unsupported(unsupportedReason: string): NormalizationResult {
  return { isUnsupported: true, unsupportedReason };
}

function readStringArray(
  raw: Record<string, unknown>,
): { value?: string[]; error?: string } {
  if (!('args' in raw)) return {};
  if (!Array.isArray(raw.args) || raw.args.some((argument) => typeof argument !== 'string')) {
    return { error: 'args must be an array of strings' };
  }
  return { value: raw.args };
}

function readStringMap(
  raw: Record<string, unknown>,
  field: string,
): { value?: StringMap; error?: string } {
  if (!(field in raw)) return {};
  if (!isStringMap(raw[field])) {
    return { error: `${field} must be a mapping of string to string` };
  }
  return { value: raw[field] };
}

function readHeaders(
  raw: Record<string, unknown>,
  sources: readonly HeaderSource[],
): { value?: StringMap; error?: string } {
  for (const source of sources) {
    const result = readStringMap(raw, source.field);
    if (result.error) {
      if (source.ignoreInvalid) continue;
      return result;
    }
    if (result.value) return result;
  }
  return {};
}

function normalizeServer(
  raw: unknown,
  config: ClientNormalization,
): NormalizationResult {
  if (!isRecord(raw)) {
    return unsupported('Server definition must be an object');
  }

  const command = raw.command;
  const hasCommand = typeof command === 'string';
  const url = config.urlFields
    .map((field) => raw[field])
    .find((value): value is string => typeof value === 'string');
  const hasUrl = url !== undefined;

  if (!hasCommand && !hasUrl) {
    return unsupported(config.missingTransportReason);
  }
  if (hasCommand && hasUrl) {
    return unsupported(config.bothTransportReason);
  }

  if (typeof command === 'string') {
    const args = readStringArray(raw);
    if (args.error) return unsupported(args.error);
    const env = readStringMap(raw, 'env');
    if (env.error) return unsupported(env.error);

    const result: NormalizedStdioServer = { transport: 'stdio', command };
    if (args.value) result.args = args.value;
    if (env.value) result.env = env.value;
    return { normalized: result, isUnsupported: false };
  }

  if (url === undefined) return unsupported(config.missingTransportReason);

  const headers = readHeaders(raw, config.headerSources);
  if (headers.error) return unsupported(headers.error);

  const result: NormalizedHttpServer = {
    transport: 'http',
    url,
    type: config.httpType(raw),
  };
  if (headers.value) result.headers = headers.value;
  return { normalized: result, isUnsupported: false };
}

const CLIENT_FILE_SPECS: readonly ClientFileSpec[] = [
  {
    filePath: '.mcp.json',
    client: 'claude',
    serverKey: 'mcpServers',
    topLevelError: 'Top-level must be a JSON object',
    serverMappingError: '"mcpServers" must be a JSON mapping',
    syntaxError: 'Syntax error parsing JSON',
    parse: JSON.parse,
    normalization: {
      urlFields: ['url'],
      missingTransportReason: 'Server must define command or url',
      bothTransportReason: 'Server cannot define both command and url',
      headerSources: [{ field: 'headers' }],
      httpType: (raw) => typeof raw.type === 'string' ? raw.type : 'http',
    },
  },
  {
    filePath: '.vscode/mcp.json',
    client: 'vscode',
    serverKey: 'servers',
    topLevelError: 'Top-level must be a JSON object',
    serverMappingError: '"servers" must be a JSON mapping',
    syntaxError: 'Syntax error parsing JSON',
    parse: JSON.parse,
    normalization: {
      urlFields: ['url'],
      missingTransportReason: 'Server must define command or url',
      bothTransportReason: 'Server cannot define both command and url',
      headerSources: [{ field: 'headers' }],
      httpType: (raw) => typeof raw.type === 'string' ? raw.type : 'http',
    },
  },
  {
    filePath: '.agents/mcp_config.json',
    client: 'antigravity',
    serverKey: 'mcpServers',
    topLevelError: 'Top-level must be a JSON object',
    serverMappingError: '"mcpServers" must be a JSON mapping',
    syntaxError: 'Syntax error parsing JSON',
    parse: JSON.parse,
    normalization: {
      urlFields: ['serverUrl', 'url'],
      missingTransportReason: 'Server must define command or serverUrl',
      bothTransportReason: 'Server cannot define both command and serverUrl',
      headerSources: [{ field: 'headers' }],
      httpType: () => 'http',
    },
  },
  {
    filePath: '.codex/config.toml',
    client: 'codex',
    serverKey: 'mcp_servers',
    topLevelError: 'Top-level must be a TOML table',
    serverMappingError: '"mcp_servers" must be a TOML table',
    syntaxError: 'Syntax error parsing TOML',
    parse: parseToml,
    normalization: {
      urlFields: ['url'],
      missingTransportReason: 'Server must define command or url',
      bothTransportReason: 'Server cannot define both command and url',
      headerSources: [
        { field: 'http_headers' },
        { field: 'headers', ignoreInvalid: true },
      ],
      httpType: () => 'http',
    },
  },
];

function serversEqual(a: NormalizedServer, b: NormalizedServer): boolean {
  return isDeepStrictEqual(a, b);
}

function normalizedToBaseConfig(server: NormalizedServer): BaseServerConfig {
  if (server.transport === 'stdio') {
    const result: BaseServerConfig = { command: server.command };
    if (server.args) result.args = server.args;
    if (server.env) result.env = server.env;
    return result;
  }

  const http: { url: string; type: string; headers?: StringMap } = {
    url: server.url,
    type: server.type || 'http',
  };
  if (server.headers) http.headers = server.headers;
  return { http };
}

function normalizedToClientOverride(server: NormalizedServer): ClientOverrideConfig {
  if (server.transport === 'stdio') {
    const result: ClientOverrideConfig = { command: server.command };
    if (server.args) result.args = server.args;
    if (server.env) result.env = server.env;
    return result;
  }

  const http: { url: string; type: string; headers?: StringMap } = {
    url: server.url,
    type: server.type || 'http',
  };
  if (server.headers) http.headers = server.headers;
  return { http };
}

function haveEquivalentEndpoint(
  first: NormalizedServer,
  entries: ReadonlyArray<{ client: ClientName; norm: NormalizedServer }>,
): boolean {
  if (first.transport === 'stdio') {
    return entries.every(
      ({ norm }) => norm.transport === 'stdio' && norm.command === first.command,
    );
  }
  return entries.every(
    ({ norm }) => norm.transport === 'http' && norm.url === first.url,
  );
}

function classifyServer(
  name: string,
  entries: DiscoveredServerClientEntry[],
): {
  classification: McpClassification;
  explanation: string;
  recommendedChoice: 'import' | 'import_with_overrides' | 'leave_unmanaged' | 'skip';
  consolidatedDefinition?: BaseServerConfig;
} {
  const credentialEntry = entries.find((entry) => entry.hasCredentials);
  if (credentialEntry) {
    return {
      classification: 'literal_credentials',
      explanation: `Server "${name}" in ${credentialEntry.filePath} contains literal credentials in ${credentialEntry.credentialField}. Secrets must not be imported; use environment variables like \${VAR} instead.`,
      recommendedChoice: 'leave_unmanaged',
    };
  }

  const unsupportedEntry = entries.find((entry) => entry.isUnsupported);
  if (unsupportedEntry) {
    return {
      classification: 'unsupported',
      explanation: `Server "${name}" in ${unsupportedEntry.filePath} is unsupported: ${unsupportedEntry.unsupportedReason}. Leave unmanaged to avoid data loss.`,
      recommendedChoice: 'leave_unmanaged',
    };
  }

  const normalizedEntries: Array<{ client: ClientName; norm: NormalizedServer }> = [];
  for (const entry of entries) {
    if (entry.normalized) {
      normalizedEntries.push({ client: entry.client, norm: entry.normalized });
    }
  }

  const first = normalizedEntries[0];
  if (!first) {
    return {
      classification: 'unsupported',
      explanation: `Server "${name}" has no supported configuration. Leave unmanaged to avoid data loss.`,
      recommendedChoice: 'leave_unmanaged',
    };
  }

  if (normalizedEntries.length === 1) {
    return {
      classification: 'identical',
      explanation: `Server "${name}" is valid and ready to import into ${DRAKOM_DIR}/mcp-servers.yaml.`,
      recommendedChoice: 'import',
      consolidatedDefinition: normalizedToBaseConfig(first.norm),
    };
  }

  if (normalizedEntries.every(({ norm }) => serversEqual(first.norm, norm))) {
    return {
      classification: 'identical',
      explanation: `Server "${name}" is identical across all client files and safe to consolidate.`,
      recommendedChoice: 'import',
      consolidatedDefinition: normalizedToBaseConfig(first.norm),
    };
  }

  if (haveEquivalentEndpoint(first.norm, normalizedEntries)) {
    const consolidated = normalizedToBaseConfig(first.norm);
    const overrides: Record<string, ClientOverrideConfig> = {};

    for (const { client, norm } of normalizedEntries) {
      if (!serversEqual(first.norm, norm)) {
        overrides[client] = normalizedToClientOverride(norm);
      }
    }

    consolidated.overrides = overrides;
    return {
      classification: 'equivalent_override',
      explanation: `Server "${name}" has client-specific differences that can be represented via overrides in ${DRAKOM_DIR}/mcp-servers.yaml.`,
      recommendedChoice: 'import_with_overrides',
      consolidatedDefinition: consolidated,
    };
  }

  return {
    classification: 'conflicting',
    explanation: `Server "${name}" defines conflicting commands or endpoints across clients. Conflicting definitions cannot be automatically reconciled.`,
    recommendedChoice: 'leave_unmanaged',
  };
}

export function discoverMcp(inventory: TargetInventory): DiscoveredMcpConfiguration {
  const clientFiles: string[] = [];
  const fileErrors: Record<string, string> = {};
  const serverMap = new Map<string, DiscoveredServerClientEntry[]>();

  const addEntry = (name: string, entry: DiscoveredServerClientEntry) => {
    const existing = serverMap.get(name) ?? [];
    existing.push(entry);
    serverMap.set(name, existing);
  };

  for (const spec of CLIENT_FILE_SPECS) {
    const content = inventory.contents[spec.filePath];
    if (content === undefined) continue;

    clientFiles.push(spec.filePath);
    try {
      const parsed = spec.parse(content);
      if (!isRecord(parsed)) {
        fileErrors[spec.filePath] = spec.topLevelError;
        continue;
      }

      const rawServers = parsed[spec.serverKey];
      if (rawServers !== undefined && !isRecord(rawServers)) {
        fileErrors[spec.filePath] = spec.serverMappingError;
        continue;
      }
      if (!isRecord(rawServers)) continue;

      for (const [name, rawServer] of Object.entries(rawServers)) {
        const credentialCheck = checkLiteralCredentials(rawServer);
        const normalized = normalizeServer(rawServer, spec.normalization);
        addEntry(name, {
          filePath: spec.filePath,
          client: spec.client,
          raw: rawServer,
          normalized: normalized.normalized,
          isUnsupported: normalized.isUnsupported,
          unsupportedReason: normalized.unsupportedReason,
          hasCredentials: credentialCheck.hasCredentials,
          credentialField: credentialCheck.field,
        });
      }
    } catch {
      fileErrors[spec.filePath] = spec.syntaxError;
    }
  }

  // 5. Authoritative Drakom source: ${DRAKOM_DIR}/mcp-servers.yaml
  const registryRelPath = `${DRAKOM_DIR}/mcp-servers.yaml`;
  const registryContent = inventory.contents[registryRelPath];
  let registry: McpRegistry | null = null;
  let registryError: string | undefined;

  if (registryContent !== undefined) {
    try {
      const parsed = loadYaml(registryContent);
      if (isRecord(parsed) && isRecord(parsed.servers)) {
        registry = { servers: parsed.servers as Record<string, BaseServerConfig> };
      } else {
        registryError = 'Registry must contain a "servers" mapping';
      }
    } catch {
      registryError = 'Syntax error parsing YAML';
    }
  }

  // Build summaries
  const servers = new Map<string, DiscoveredServerSummary>();
  for (const [name, entries] of serverMap.entries()) {
    const summary = classifyServer(name, entries);
    servers.set(name, {
      name,
      entries,
      ...summary,
    });
  }

  const result: DiscoveredMcpConfiguration = {
    registryPath: registryContent !== undefined ? registryRelPath : null,
    registry,
    registryError,
    clientFiles,
    servers,
  };
  if (Object.keys(fileErrors).length > 0) {
    result.fileErrors = fileErrors;
  }
  return result;
}

export function renderMcpComparisonReport(discovered: DiscoveredMcpConfiguration): string {
  const lines: string[] = [
    '# Drakom AI MCP Comparison Report',
    '',
    `Discovered client configuration files: ${discovered.clientFiles.length > 0 ? discovered.clientFiles.join(', ') : 'none'}`,
    `Authoritative registry: ${discovered.registryPath ? discovered.registryPath : 'none (uninitialized or skipped)'}`,
    '',
  ];

  if (discovered.fileErrors && Object.keys(discovered.fileErrors).length > 0) {
    lines.push('## Configuration Errors', '');
    lines.push('The following client configuration files contained syntax or structural errors:');
    for (const [filePath, errorMsg] of Object.entries(discovered.fileErrors)) {
      lines.push(`- **${filePath}**: ${errorMsg}. Safe next action: correct file syntax in ${filePath}.`);
    }
    lines.push('');
  }

  if (discovered.servers.size === 0) {
    lines.push('No MCP server configurations discovered across repository client files.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## Discovered MCP Servers', '');

  for (const [name, summary] of discovered.servers) {
    const sources = summary.entries.map((e) => e.filePath).join(', ');
    lines.push(`### Server: \`${name}\``);
    lines.push(`- **Sources:** ${sources}`);
    lines.push(`- **Classification:** ${summary.classification}`);
    lines.push(`- **Status:** ${summary.explanation}`);
    lines.push('- **Available Import Choices:**');
    lines.push(`  1. Import into ${DRAKOM_DIR}/mcp-servers.yaml`);
    lines.push('  2. Import with explicit client overrides');
    lines.push('  3. Leave unmanaged');
    lines.push('  4. Skip MCP management');
    lines.push(`- **Recommendation:** ${summary.recommendedChoice}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function applyMcpImport(
  existingRegistryYaml: string,
  decisions: Record<string, McpImportChoice>,
  discovered: DiscoveredMcpConfiguration,
): string {
  let parsed: unknown;
  try {
    parsed = loadYaml(existingRegistryYaml) || {};
  } catch (err) {
    throw new Error(`Invalid registry YAML: ${err instanceof Error ? err.message : String(err)}`);
  }

  const registryRecord: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  if (!isRecord(registryRecord.servers)) {
    registryRecord.servers = {};
  }
  const servers = registryRecord.servers as Record<string, unknown>;

  for (const [name, choice] of Object.entries(decisions)) {
    if (choice === 'leave_unmanaged' || choice === 'skip') {
      continue;
    }

    const serverSummary = discovered.servers.get(name);
    if (!serverSummary) {
      throw new Error(`Server "${name}" was not found in discovered MCP configuration.`);
    }

    if (serverSummary.classification === 'literal_credentials') {
      throw new Error(
        `Cannot import server "${name}": contains literal credentials. Replace literal secrets with environment variable references like \${VAR} before importing.`,
      );
    }

    if (serverSummary.classification === 'unsupported') {
      throw new Error(
        `Cannot import server "${name}": server definition is unsupported or not losslessly representable.`,
      );
    }

    if (serverSummary.classification === 'conflicting') {
      throw new Error(
        `Cannot import server "${name}": definitions conflict across client files. Resolve conflicting definitions manually before importing.`,
      );
    }

    if (!serverSummary.consolidatedDefinition) {
      throw new Error(`Server "${name}" has no consolidated definition available.`);
    }

    servers[name] = serverSummary.consolidatedDefinition;
  }

  return dumpYaml(parsed, { indent: 2, lineWidth: -1 });
}
