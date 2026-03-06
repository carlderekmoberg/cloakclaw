#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { cloakCommand } from '../src/commands/cloak.js';
import { decloakCommand } from '../src/commands/decloak.js';
import { diffCommand } from '../src/commands/diff.js';
import { sessionsCommand } from '../src/commands/sessions.js';
import { sessionCommand } from '../src/commands/session.js';
import { configCommand } from '../src/commands/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('cloakclaw')
  .description('Local AI privacy proxy — redact sensitive data before sending to cloud LLMs')
  .version(pkg.version);

program
  .command('cloak [file]')
  .description('Cloak sensitive data in a document')
  .option('-p, --profile <profile>', 'document profile (legal, financial, email)', 'email')
  .option('-i, --interactive', 'interactive mode — approve each entity')
  .option('-c, --copy', 'copy cloaked output to clipboard')
  .option('-o, --output <file>', 'write cloaked output to file')
  .option('--no-llm', 'skip Ollama LLM pass (regex only)')
  .action(cloakCommand);

program
  .command('decloak')
  .description('De-cloak an LLM response (restore original entities)')
  .requiredOption('-s, --session <id>', 'session ID from the cloak operation')
  .option('-f, --file <file>', 'read LLM response from file (otherwise reads stdin)')
  .option('-o, --output <file>', 'write de-cloaked output to file')
  .option('-c, --copy', 'copy de-cloaked output to clipboard')
  .action(decloakCommand);

program
  .command('diff')
  .description('Show what was cloaked in a session')
  .requiredOption('-s, --session <id>', 'session ID')
  .action(diffCommand);

program
  .command('sessions')
  .description('List recent cloaking sessions')
  .option('-n, --limit <n>', 'number of sessions to show', '20')
  .action(sessionsCommand);

program
  .command('session <id>')
  .description('Show details for a specific session')
  .action(sessionCommand);

program
  .command('config')
  .description('Get or set config values')
  .argument('<action>', 'get, set, or show')
  .argument('[key]', 'config key (e.g., ollama.model)')
  .argument('[value]', 'value to set')
  .action(configCommand);

program.parse();
