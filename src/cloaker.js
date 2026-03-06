import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import { regexPass } from './ner/regex-pass.js';
import { llmPass, isOllamaAvailable } from './ner/llm-pass.js';
import { getProfile } from './profiles/index.js';
import { ReplacementGenerator } from './replacements/generator.js';
import { MappingStore } from './store/sqlite.js';
import { createInterface } from 'readline';

export class Cloaker {
  constructor(opts = {}) {
    this.store = new MappingStore();
    this.interactive = opts.interactive || false;
    this.useLlm = opts.useLlm !== false;
    this.isTTY = process.stderr.isTTY;
    this.onProgress = opts.onProgress || null; // callback(step, data)
    this.entityTypes = opts.entityTypes || null; // null = use profile defaults
  }

  _emit(step, data = {}) {
    if (this.onProgress) this.onProgress(step, data);
  }

  /**
   * Cloak a document.
   * @param {string} text - original text
   * @param {string} profileName - profile to use
   * @returns {Promise<{cloaked: string, sessionId: string, entities: Array}>}
   */
  async cloak(text, profileName) {
    const profile = getProfile(profileName);
    const sessionId = uuidv4();
    const generator = new ReplacementGenerator();

    // Create session
    this.store.createSession(sessionId, profileName, {
      originalLength: text.length,
      numberScaleFactor: generator.numberScaleFactor,
      dateShiftDays: generator.dateShiftDays,
    });

    this._emit('init', { sessionId, profile: profile.name, description: profile.description, textLength: text.length });

    if (this.isTTY) {
      process.stderr.write(chalk.dim(`Session: ${sessionId}\n`));
      process.stderr.write(chalk.dim(`Profile: ${profile.name} — ${profile.description}\n`));
    }

    // Use custom entity types if provided, otherwise profile defaults
    const activeEntityTypes = this.entityTypes || profile.entityTypes;
    const activeLlmTypes = this.entityTypes
      ? profile.llmTypes.filter(t => this.entityTypes.includes(t))
      : profile.llmTypes;

    // Pass 1: Regex
    this._emit('regex_start', {});
    if (this.isTTY) process.stderr.write(chalk.cyan('⚡ Regex pass... '));
    let entities = regexPass(text, activeEntityTypes);
    if (this.isTTY) process.stderr.write(chalk.cyan(`${entities.length} entities\n`));

    // Summarize found types
    const typeCounts = {};
    entities.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });
    this._emit('regex_done', { count: entities.length, types: typeCounts });

    // Pass 2: LLM (if enabled and available)
    if (this.useLlm && activeLlmTypes.length > 0) {
      this._emit('llm_start', { model: (await import('./config.js')).getConfig().ollama.model });
      if (this.isTTY) process.stderr.write(chalk.cyan('🧠 LLM pass... '));
      const ollamaUp = await isOllamaAvailable();
      if (ollamaUp) {
        const llmEntities = await llmPass(text, profile.name, activeLlmTypes, entities);
        if (this.isTTY) process.stderr.write(chalk.cyan(`${llmEntities.length} additional entities\n`));

        const llmTypeCounts = {};
        llmEntities.forEach(e => { llmTypeCounts[e.type] = (llmTypeCounts[e.type] || 0) + 1; });
        this._emit('llm_done', { count: llmEntities.length, types: llmTypeCounts });

        // Merge, avoiding overlaps
        const allEntities = [...entities];
        for (const le of llmEntities) {
          const overlaps = allEntities.some(e =>
            (le.start >= e.start && le.start < e.end) ||
            (le.end > e.start && le.end <= e.end)
          );
          if (!overlaps) allEntities.push(le);
        }
        entities = allEntities.sort((a, b) => a.start - b.start);
      } else {
        this._emit('llm_unavailable', {});
        if (this.isTTY) {
          process.stderr.write(chalk.yellow('⚠ Ollama not available — regex only\n'));
        }
      }
    }

    // Interactive approval
    if (this.interactive && entities.length > 0) {
      entities = await this._interactiveApproval(entities);
    }

    this._emit('replacing', { totalEntities: entities.length });

    // Generate replacements and build cloaked text
    let cloaked = '';
    let lastEnd = 0;
    const mappings = [];

    for (const entity of entities) {
      // Check allowlist
      const action = this.store.getAllowlistAction(entity.match);
      if (action === 'never_cloak') continue;

      const replacement = generator.generate(entity.match, entity.type);
      cloaked += text.slice(lastEnd, entity.start) + replacement;
      lastEnd = entity.end;

      mappings.push({
        original: entity.match,
        replacement,
        type: entity.type,
      });
    }
    cloaked += text.slice(lastEnd);

    // Store mappings (deduplicated)
    const stored = new Set();
    for (const m of mappings) {
      const key = `${m.original}::${m.replacement}`;
      if (!stored.has(key)) {
        this.store.addMapping(sessionId, m.original, m.replacement, m.type);
        stored.add(key);
      }
    }

    // Update session
    this.store.updateSession(sessionId, {
      cloakedLength: cloaked.length,
      entityCount: stored.size,
    });

    this._emit('complete', {
      sessionId, entityCount: stored.size,
      originalLength: text.length, cloakedLength: cloaked.length,
    });

    if (this.isTTY) {
      process.stderr.write(chalk.green(`\n✓ Cloaked ${stored.size} unique entities\n`));
      process.stderr.write(chalk.dim(`  Original: ${text.length} chars → Cloaked: ${cloaked.length} chars\n`));
      process.stderr.write(chalk.dim(`  Session: ${sessionId}\n`));
      process.stderr.write(chalk.dim(`  Decloak: cloakclaw decloak -s ${sessionId.slice(0, 8)}\n\n`));
    }

    return { cloaked, sessionId, entities: [...stored].map(k => {
      const [orig, repl] = k.split('::');
      return { original: orig, replacement: repl };
    })};
  }

  async _interactiveApproval(entities) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));

    const approved = [];
    process.stderr.write(chalk.yellow(`\n🔍 Review ${entities.length} entities:\n\n`));

    for (const entity of entities) {
      // Check allowlist first
      const action = this.store.getAllowlistAction(entity.match);
      if (action === 'always_cloak') {
        approved.push(entity);
        process.stderr.write(chalk.dim(`  ✓ ${entity.match} [${entity.type}] — auto-cloaked (allowlist)\n`));
        continue;
      }
      if (action === 'never_cloak') {
        process.stderr.write(chalk.dim(`  ✗ ${entity.match} [${entity.type}] — skipped (allowlist)\n`));
        continue;
      }

      const answer = await ask(
        chalk.white(`  ${chalk.bold(entity.match)} `) +
        chalk.dim(`[${entity.type}]`) +
        chalk.white(' — Cloak? ') +
        chalk.dim('[Y/n/always/never] ')
      );

      const a = answer.trim().toLowerCase();
      if (a === 'n' || a === 'no') {
        continue;
      } else if (a === 'always') {
        this.store.setAllowlistAction(entity.match, entity.type, 'always_cloak');
        approved.push(entity);
      } else if (a === 'never') {
        this.store.setAllowlistAction(entity.match, entity.type, 'never_cloak');
      } else {
        approved.push(entity);
      }
    }

    rl.close();
    process.stderr.write('\n');
    return approved;
  }

  close() {
    this.store.close();
  }
}
