export type HelpTopic = 'global' | 'init' | 'sync';

export type CliArguments =
  | {
      command: 'init';
      targetPath: string;
      dryRun: boolean;
      yes: boolean;
      skipMcp: boolean;
    }
  | { command: 'sync'; targetPath: string; dryRun: boolean; check: boolean }
  | { command: 'help'; topic: HelpTopic }
  | { command: 'version' };

/**
 * Parse the public CLI surface without performing any I/O.
 */
export function parseCliArgs(argv: string[]): CliArguments {
  const [command, ...tokens] = argv;
  if (command === '--help' || command === '-h') {
    if (tokens.length > 0) {
      throw new Error(`${command} does not accept additional arguments.`);
    }
    return { command: 'help', topic: 'global' };
  }

  if (command === '--version' || command === '-V') {
    if (tokens.length > 0) {
      throw new Error(`${command} does not accept additional arguments.`);
    }
    return { command: 'version' };
  }

  if (command !== 'init' && command !== 'sync') {
    throw new Error('Expected "init" or "sync" as the first argument. Run "drakom-ai --help" for usage.');
  }

  if (tokens.includes('--help') || tokens.includes('-h')) {
    return { command: 'help', topic: command };
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
  const flagsByCommand = { init: new Set(['--yes', '--skip-mcp']), sync: new Set(['--check']) };
  const otherCommand = command === 'init' ? 'sync' : 'init';
  for (const flag of flags) {
    if (commonFlags.has(flag) || flagsByCommand[command].has(flag)) {
      continue;
    }
    if (flagsByCommand[otherCommand].has(flag)) {
      throw new Error(`${flag} is available only with ${otherCommand}.`);
    }
    throw new Error(`Unknown option ${flag}. Run "drakom-ai ${command} --help" for usage.`);
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
