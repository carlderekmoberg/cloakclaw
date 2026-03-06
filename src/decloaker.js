import chalk from 'chalk';
import { MappingStore } from './store/sqlite.js';

export class Decloaker {
  constructor() {
    this.store = new MappingStore();
  }

  /**
   * De-cloak text by reversing all replacements for a session.
   * @param {string} text - cloaked text (LLM response)
   * @param {string} sessionId - session ID (or partial)
   * @returns {{decloaked: string, restoredCount: number}}
   */
  decloak(text, sessionId) {
    // Support partial session IDs
    let session = this.store.getSession(sessionId);
    if (!session) {
      session = this.store.findSession(sessionId);
    }
    if (!session) {
      throw new Error(
        `Session not found: ${sessionId}\n` +
        `Run 'cloakclaw sessions' to see recent sessions.`
      );
    }

    const mappings = this.store.getMappings(session.id);
    if (mappings.length === 0) {
      throw new Error(`No mappings found for session ${session.id}`);
    }

    let decloaked = text;
    let restoredCount = 0;

    // Sort by replacement length (longest first) to avoid partial replacements
    const sorted = [...mappings].sort((a, b) => b.replacement.length - a.replacement.length);

    for (const mapping of sorted) {
      const before = decloaked;
      // Replace all occurrences (case-sensitive)
      decloaked = decloaked.split(mapping.replacement).join(mapping.original);
      if (decloaked !== before) restoredCount++;
    }

    if (process.stderr.isTTY) {
      process.stderr.write(chalk.green(`✓ Restored ${restoredCount} entities from session ${session.id.slice(0, 8)}…\n`));
    }

    return { decloaked, restoredCount };
  }

  close() {
    this.store.close();
  }
}
