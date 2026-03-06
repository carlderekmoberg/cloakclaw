import chalk from 'chalk';
import { MappingStore } from './store/sqlite.js';

/**
 * Show a visual diff of what was cloaked in a session.
 */
export function showDiff(sessionId) {
  const store = new MappingStore();

  let session = store.getSession(sessionId);
  if (!session) session = store.findSession(sessionId);
  if (!session) {
    store.close();
    throw new Error(`Session not found: ${sessionId}\nRun 'cloakclaw sessions' to see recent sessions.`);
  }

  const mappings = store.getMappings(session.id);
  store.close();

  if (mappings.length === 0) {
    console.log(chalk.yellow('No mappings found for this session.'));
    return;
  }

  console.log(chalk.bold(`\nSession: ${session.id}`));
  console.log(chalk.dim(`Profile: ${session.profile} | Created: ${session.created_at}`));
  console.log(chalk.dim(`Original: ${session.original_length} chars → Cloaked: ${session.cloaked_length} chars`));
  console.log(chalk.dim(`Scale factor: ${session.number_scale_factor?.toFixed(2)} | Date shift: ${session.date_shift_days} days`));
  console.log(chalk.bold(`\n${'─'.repeat(70)}`));
  console.log(chalk.bold(`  ${'Entity Type'.padEnd(12)} ${'Original'.padEnd(28)} → Replacement`));
  console.log(chalk.bold(`${'─'.repeat(70)}`));

  for (const m of mappings) {
    const typeLabel = chalk.cyan(m.entity_type.padEnd(12));
    const original = chalk.red(truncate(m.original, 26).padEnd(28));
    const replacement = chalk.green(truncate(m.replacement, 28));
    console.log(`  ${typeLabel} ${original} → ${replacement}`);
  }

  console.log(chalk.bold(`${'─'.repeat(70)}`));
  console.log(chalk.dim(`  ${mappings.length} entities cloaked\n`));
}

function truncate(str, len) {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + '…';
}
