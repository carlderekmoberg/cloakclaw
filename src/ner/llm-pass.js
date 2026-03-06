/**
 * Ollama-based contextual NER pass.
 * Uses local LLM to identify entities that regex can't catch
 * (people names, company names, product names, business terms).
 */

import { getConfig } from '../config.js';

/**
 * Check if Ollama is reachable.
 * @returns {Promise<boolean>}
 */
export async function isOllamaAvailable() {
  const config = getConfig();
  try {
    const resp = await fetch(`${config.ollama.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Call Ollama to extract entities from text.
 * @param {string} text - the document text
 * @param {string} profile - document profile name
 * @param {string[]} entityTypes - which types to look for
 * @param {Array} alreadyFound - entities already found by regex (to avoid duplicates)
 * @returns {Promise<Array<{match: string, type: string}>>}
 */
export async function llmPass(text, profile, entityTypes, alreadyFound = []) {
  const config = getConfig();

  // Build a focused prompt
  const existingEntities = alreadyFound.map(e => e.match).join(', ');
  const typesNeeded = entityTypes
    .filter(t => ['person', 'company', 'jurisdiction', 'bank'].includes(t))
    .join(', ');

  if (!typesNeeded) return [];

  const prompt = `You are an entity extraction tool. Extract all ${typesNeeded} entities from the following ${profile} document.

Rules:
- Return ONLY a JSON array of objects: [{"entity": "exact text", "type": "person|company|jurisdiction|bank"}]
- Extract the exact text as it appears in the document
- Do NOT include entities already found: ${existingEntities || 'none'}
- Do NOT include common/generic terms (like "the company", "the client")
- Do NOT include any explanation, just the JSON array
- If no entities found, return []

Document:
---
${text.slice(0, 4000)}
---

JSON:`;

  try {
    const resp = await fetch(`${config.ollama.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.model,
        prompt,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 1024,
        },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) {
      throw new Error(`Ollama returned ${resp.status}`);
    }

    const data = await resp.json();
    const raw = data.response || '';

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = raw.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return [];

    const entities = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(entities)) return [];

    // Validate and find positions in text
    const results = [];
    const existingSet = new Set(alreadyFound.map(e => e.match.toLowerCase()));

    for (const ent of entities) {
      if (!ent.entity || !ent.type) continue;
      if (existingSet.has(ent.entity.toLowerCase())) continue;

      // Find all occurrences in text
      let searchFrom = 0;
      while (true) {
        const idx = text.indexOf(ent.entity, searchFrom);
        if (idx === -1) break;
        results.push({
          match: ent.entity,
          start: idx,
          end: idx + ent.entity.length,
          type: ent.type,
        });
        searchFrom = idx + ent.entity.length;
      }
    }

    return results;
  } catch (err) {
    // Graceful degradation — return empty if Ollama fails
    return [];
  }
}
