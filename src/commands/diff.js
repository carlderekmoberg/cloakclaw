import chalk from 'chalk';
import { showDiff } from '../diff.js';

export function diffCommand(opts) {
  try {
    showDiff(opts.session);
  } catch (err) {
    process.stderr.write(chalk.red(`Error: ${err.message}\n`));
    process.exit(1);
  }
}
