#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';

import { runCli } from './run-cli.js';

async function askYesNo(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(question);
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    prompt.close();
  }
}

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  confirm: () => askYesNo('Apply this operation plan? [y/N] '),
  selectPlanAudit: () =>
    process.stdin.isTTY ? askYesNo('Install the optional local plan-audit skill? [y/N] ') : Promise.resolve(false),
});
