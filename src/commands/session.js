import chalk from 'chalk';
import { showDiff } from '../diff.js';

export function sessionCommand(id) {
  try {
    showDiff(id);
  } catch (err) {
    process.stderr.write(chalk.red(`Error: ${err.message}\n`));
    process.exit(1);
  }
}
