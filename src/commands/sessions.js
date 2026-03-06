import chalk from 'chalk';
import { MappingStore } from '../store/sqlite.js';

export function sessionsCommand(opts) {
  const store = new MappingStore();
  const sessions = store.listSessions(parseInt(opts.limit) || 20);
  store.close();

  if (sessions.length === 0) {
    console.log(chalk.dim('No sessions yet. Run: cloakclaw cloak <file> --profile <profile>'));
    return;
  }

  console.log(chalk.bold(`\nRecent Sessions (${sessions.length}):`));
  console.log(chalk.bold(`${'─'.repeat(80)}`));
  console.log(
    chalk.bold(
      `  ${'ID'.padEnd(10)} ${'Profile'.padEnd(12)} ${'Entities'.padEnd(10)} ${'Size'.padEnd(16)} Created`
    )
  );
  console.log(chalk.bold(`${'─'.repeat(80)}`));

  for (const s of sessions) {
    const id = chalk.cyan(s.id.slice(0, 8) + '…');
    const profile = s.profile.padEnd(12);
    const entities = String(s.entity_count || 0).padEnd(10);
    const size = `${s.original_length}→${s.cloaked_length}`.padEnd(16);
    const created = s.created_at;
    console.log(`  ${id} ${profile} ${entities} ${size} ${created}`);
  }

  console.log(chalk.bold(`${'─'.repeat(80)}\n`));
}
