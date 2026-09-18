export type CliArguments =
  | { command: 'init'; targetPath: string; dryRun: boolean; yes: boolean; skipMcp: boolean }
  | { command: 'sync'; targetPath: string; dryRun: boolean; check: boolean };

/**
 * Parse the public CLI surface without performing any I/O.
 */
export function parseCliArgs(argv: string[]): CliArguments {
  const [command, ...tokens] = argv;
  if (command !== 'init' && command !== 'sync') {
    throw new Error('Expected "init" or "sync" as the first argument.');
  }

  let targetPath: string | null = null;
  const flags = new Set<string>();
  for (const token of tokens) {
    if (token.startsWith('-')) {
      if (flags.has(token)) {
        throw new Error(`Flag ${token} may be provided only once.`);
      }
      flags.add(token);
    } else if (targetPath === null) {
      targetPath = token;
    } else {
      throw new Error(`Unexpected second target path: ${token}`);
    }
  }

  const commonFlags = new Set(['--dry-run']);
  const commandFlags = command === 'init' ? new Set(['--yes', '--skip-mcp']) : new Set(['--check']);
  for (const flag of flags) {
    if (!commonFlags.has(flag) && !commandFlags.has(flag)) {
      const otherCommand = flag === '--check' ? 'sync' : 'init';
      throw new Error(`${flag} is available only with ${otherCommand}.`);
    }
  }

  if (command === 'init') {
    return {
      command,
      targetPath: targetPath ?? '.',
      dryRun: flags.has('--dry-run'),
      yes: flags.has('--yes'),
      skipMcp: flags.has('--skip-mcp'),
    };
  }

  return {
    command,
    targetPath: targetPath ?? '.',
    dryRun: flags.has('--dry-run'),
    check: flags.has('--check'),
  };
}
