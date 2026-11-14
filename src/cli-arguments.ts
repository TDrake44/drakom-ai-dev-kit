export type HelpTopic = 'global' | 'init' | 'sync';

export type CliArguments =
  | {
      command: 'init';
      targetPath: string;
      dryRun: boolean;
      yes: boolean;
      skipMcp: boolean;
    }
  | {
      command: 'sync';
      targetPath: string;
      dryRun: boolean;
      check: boolean;
      /** Managed-file paths whose local edits the user keeps, as typed. */
      accept: string[];
      /** Managed-file paths the kit stops managing, as typed. */
      release: string[];
    }
  | { command: 'help'; topic: HelpTopic }
  | { command: 'version' };

/** Repeatable sync options that take a path, written as `--name <path>` or `--name=<path>`. */
const valueOptions = ['--accept', '--release'] as const;
type ValueOption = (typeof valueOptions)[number];

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
  const values: Record<ValueOption, string[]> = { '--accept': [], '--release': [] };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const valueOption = valueOptions.find((name) => token === name || token.startsWith(`${name}=`));
    if (valueOption !== undefined) {
      if (command !== 'sync') {
        throw new Error(`${valueOption} is available only with sync.`);
      }
      let value: string | undefined;
      if (token === valueOption) {
        index += 1;
        value = tokens[index];
        if (value === undefined || value.startsWith('-')) {
          throw new Error(
            `${valueOption} requires a path, for example ${valueOption} .agents/skills/<name>/SKILL.md. Run "drakom-ai sync --help" for usage.`,
          );
        }
      } else {
        value = token.slice(valueOption.length + 1);
        if (value.length === 0) {
          throw new Error(`${valueOption} requires a path. Run "drakom-ai sync --help" for usage.`);
        }
      }
      values[valueOption].push(value);
    } else if (token.startsWith('-')) {
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

  if (flags.has('--check') && (values['--accept'].length > 0 || values['--release'].length > 0)) {
    throw new Error('--check only reports drift and cannot be combined with --accept or --release.');
  }

  return {
    command,
    targetPath: targetPath ?? '.',
    dryRun: flags.has('--dry-run'),
    check: flags.has('--check'),
    accept: values['--accept'],
    release: values['--release'],
  };
}
