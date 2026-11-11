#!/usr/bin/env node

import { createInterface } from 'node:readline';

import { runCli, type ConfirmAnswer } from './run-cli.js';

async function askYesNo(question: string): Promise<ConfirmAnswer> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    // The first event wins: readline emits a final unterminated line before it closes, and a close
    // without any line means input ended before an answer arrived.
    const answer = await new Promise<string | null>((resolve) => {
      prompt.once('line', resolve);
      prompt.once('close', () => resolve(null));
      prompt.setPrompt(question);
      prompt.prompt();
    });
    if (answer === null) {
      process.stdout.write('\n');
      return 'no-answer';
    }
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    prompt.close();
  }
}

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  confirm: () => askYesNo('Apply this operation plan? [y/N] '),
});
