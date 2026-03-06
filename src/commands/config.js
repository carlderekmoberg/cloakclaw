import chalk from 'chalk';
import YAML from 'yaml';
import { getConfig, setConfig, getConfigValue } from '../config.js';

export function configCommand(action, key, value) {
  switch (action) {
    case 'show': {
      const config = getConfig();
      console.log(YAML.stringify(config));
      break;
    }
    case 'get': {
      if (!key) {
        process.stderr.write(chalk.red('Usage: cloakclaw config get <key>\n'));
        process.exit(1);
      }
      const val = getConfigValue(key);
      if (val === undefined) {
        process.stderr.write(chalk.yellow(`Key "${key}" not set\n`));
      } else {
        console.log(typeof val === 'object' ? JSON.stringify(val, null, 2) : val);
      }
      break;
    }
    case 'set': {
      if (!key || value === undefined) {
        process.stderr.write(chalk.red('Usage: cloakclaw config set <key> <value>\n'));
        process.exit(1);
      }
      setConfig(key, value);
      process.stderr.write(chalk.green(`✓ Set ${key} = ${value}\n`));
      break;
    }
    default:
      process.stderr.write(chalk.red(`Unknown action: ${action}. Use: show, get, set\n`));
      process.exit(1);
  }
}
