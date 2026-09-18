#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';

import { runCli } from './run-cli.js';

async function confirm(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question('Apply this operation plan? [y/N] ');
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    prompt.close();
  }
}

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  confirm,
});
