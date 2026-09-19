import type { HelpTopic } from './cli-arguments.js';

const globalHelp = `Usage: drakom-ai <command> [options]

Commands:
  init [path]  Preview and approve initialization of a project. The default path is .
  sync [path]  Synchronize an initialized project. The default path is .

Run "drakom-ai <command> --help" for command-specific options.
`;

const initHelp = `Usage: drakom-ai init [path] [options]

Preview and interactively approve project initialization. The default path is .

Options:
  --dry-run   Render the initialization plan without making changes.
  --yes       Apply create-only initialization without prompting.
  --skip-mcp  Initialize without MCP registry management.
  -h, --help  Show this help message.
`;

const syncHelp = `Usage: drakom-ai sync [path] [options]

Synchronize managed project content. The default path is .

Options:
  --dry-run  Render the synchronization plan without making changes.
  --check    Exit nonzero when managed content has drifted.
  -h, --help Show this help message.
`;

/** Render public CLI usage without inspecting a target or loading package data. */
export function renderCliHelp(topic: HelpTopic): string {
  if (topic === 'init') return initHelp;
  if (topic === 'sync') return syncHelp;
  return globalHelp;
}
