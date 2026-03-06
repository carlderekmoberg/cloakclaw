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

program
  .command('password <action>')
  .description('Manage database password (set, remove, status)')
  .action(async (action) => {
    const { isPasswordProtected, setPassword, removePassword, unlockWithPassword } = await import('../src/store/crypto.js');
    const readline = await import('node:readline');

    function ask(q) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      return new Promise(r => rl.question(q, a => { rl.close(); r(a); }));
    }

    switch (action) {
      case 'status':
        if (isPasswordProtected()) {
          console.log(chalk.green('🔒 Database is password-protected'));
        } else {
          console.log(chalk.yellow('🔓 No password set (using auto-generated key)'));
        }
        break;

      case 'set': {
        if (isPasswordProtected()) {
          const current = await ask('Current password: ');
          try { unlockWithPassword(current); } catch { console.error(chalk.red('Wrong password')); process.exit(1); }
        }
        const pw = await ask('New password: ');
        const confirm = await ask('Confirm password: ');
        if (pw !== confirm) { console.error(chalk.red('Passwords do not match')); process.exit(1); }
        try {
          setPassword(pw);
          console.log(chalk.green('🔒 Password set. All new data will be encrypted with this password.'));
          console.log(chalk.yellow('⚠️  Existing sessions encrypted with the old key will need to be wiped:'));
          console.log(chalk.dim('   rm ~/.cloakclaw/mappings.db'));
        } catch (e) { console.error(chalk.red(e.message)); process.exit(1); }
        break;
      }

      case 'remove': {
        if (!isPasswordProtected()) { console.log(chalk.dim('No password set')); break; }
        const pw = await ask('Current password to remove: ');
        try { unlockWithPassword(pw); } catch { console.error(chalk.red('Wrong password')); process.exit(1); }
        removePassword();
        console.log(chalk.green('🔓 Password removed. Reverted to auto-generated key.'));
        console.log(chalk.yellow('⚠️  Existing encrypted data needs a fresh DB:'));
        console.log(chalk.dim('   rm ~/.cloakclaw/mappings.db'));
        break;
      }

      default:
        console.error(chalk.red('Unknown action. Use: set, remove, status'));
        process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start the web UI')
  .option('-p, --port <port>', 'port number', '3900')
  .action(async (opts) => {
    process.env.CLOAKCLAW_PORT = opts.port;
    await import('../src/server.js');
  });

program.parse();
