import type { HelpTopic } from './cli-arguments.js';

const globalHelp = `Usage: drakom-ai <command> [options]

Commands:
  init [path]  Preview and approve initialization of a project. The default path is .
  sync [path]  Synchronize an initialized project. The default path is .

Options:
  -V, --version  Print the installed drakom-ai version.
  -h, --help     Show this help message.

Run "drakom-ai <command> --help" for command-specific options.
`;

const initHelp = `Usage: drakom-ai init [path] [options]

Preview and interactively approve project initialization. The default path is .

Options:
  --dry-run   Render the initialization plan without making changes.
  --yes       Apply safe initialization without prompting; refuse structured merges.
  --skip-mcp  Initialize without MCP registry management.
  -h, --help  Show this help message.
`;

const syncHelp = `Usage: drakom-ai sync [path] [options]

Synchronize managed project content. The default path is .
A conflict holds back only its own item; everything else is applied, and the
exit code is 2 while any conflict remains.

Options:
  --dry-run         Render the synchronization plan without making changes.
  --check           Exit nonzero when managed content has drifted.
  --accept <path>   Keep your local edit to a kit-managed file. The edit stays
                    until a later kit version changes that file. Repeatable.
  --release <path>  Stop managing a kit-managed file. The file is left as it is
                    (or stays deleted) and becomes project-owned. Repeatable.
  -h, --help        Show this help message.

Paths for --accept and --release are relative to the target, as printed in the
plan. Both apply to kit-managed files only and cannot be combined with --check.
`;

/** Render public CLI usage without inspecting a target or loading package data. */
export function renderCliHelp(topic: HelpTopic): string {
  if (topic === 'init') return initHelp;
  if (topic === 'sync') return syncHelp;
  return globalHelp;
}
