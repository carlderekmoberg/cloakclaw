import { readFileSync, writeFileSync } from 'fs';
import chalk from 'chalk';
import { Decloaker } from '../decloaker.js';

export async function decloakCommand(opts) {
  let text;
  if (opts.file) {
    try {
      text = readFileSync(opts.file, 'utf-8');
    } catch (err) {
      process.stderr.write(chalk.red(`Error reading file: ${err.message}\n`));
      process.exit(1);
    }
  } else {
    // Read from stdin
    if (process.stderr.isTTY) {
      process.stderr.write(chalk.dim('Paste the LLM response, then press Ctrl+D:\n\n'));
    }
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    text = Buffer.concat(chunks).toString('utf-8');
    if (!text.trim()) {
      process.stderr.write(chalk.red('No input.\n'));
      process.exit(1);
    }
  }

  const decloaker = new Decloaker();

  try {
    const result = decloaker.decloak(text, opts.session);

    if (opts.output) {
      writeFileSync(opts.output, result.decloaked, 'utf-8');
      process.stderr.write(chalk.dim(`Written to ${opts.output}\n`));
    } else if (opts.copy) {
      const { default: clipboardy } = await import('clipboardy');
      await clipboardy.write(result.decloaked);
      process.stderr.write(chalk.dim('Copied to clipboard\n'));
    } else {
      process.stdout.write(result.decloaked);
    }
  } catch (err) {
    process.stderr.write(chalk.red(`Error: ${err.message}\n`));
    process.exit(1);
  } finally {
    decloaker.close();
  }
}
