import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import chalk from 'chalk';
import { Cloaker } from '../cloaker.js';
import { extractText } from '../extract.js';

export async function cloakCommand(file, opts) {
  let text;
  if (file) {
    try {
      const buffer = readFileSync(file);
      const filename = basename(file);
      text = await extractText(buffer, filename);
    } catch (err) {
      process.stderr.write(chalk.red(`Error reading file: ${err.message}\n`));
      process.exit(1);
    }
  } else {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    text = Buffer.concat(chunks).toString('utf-8');
    if (!text.trim()) {
      process.stderr.write(chalk.red('No input. Provide a file or pipe text via stdin.\n'));
      process.exit(1);
    }
  }

  const cloaker = new Cloaker({
    interactive: opts.interactive,
    useLlm: opts.llm !== false,
  });

  try {
    const result = await cloaker.cloak(text, opts.profile);

    // Output cloaked text
    if (opts.output) {
      writeFileSync(opts.output, result.cloaked, 'utf-8');
      process.stderr.write(chalk.dim(`Written to ${opts.output}\n`));
    } else if (opts.copy) {
      const { default: clipboardy } = await import('clipboardy');
      await clipboardy.write(result.cloaked);
      process.stderr.write(chalk.dim('Copied to clipboard\n'));
    } else {
      process.stdout.write(result.cloaked);
    }
  } catch (err) {
    process.stderr.write(chalk.red(`Error: ${err.message}\n`));
    process.exit(1);
  } finally {
    cloaker.close();
  }
}
