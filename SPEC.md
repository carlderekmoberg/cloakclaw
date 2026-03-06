# CloakClaw MVP — Build Spec

## What This Is
A Node.js CLI tool that redacts sensitive data from documents before sending to cloud LLMs, then restores originals in the response. Privacy proxy for AI.

## Architecture

### Two-Pass NER (Named Entity Recognition)
1. **Fast Pass**: Regex + pattern matching for obvious entities (emails, phone numbers, SSNs, API keys, URLs, dollar amounts, dates, account numbers)
2. **Context Pass**: Call local Ollama LLM to identify context-sensitive entities (company names, people names, product names, business terms that regex can't catch)

### Mapping Store
- SQLite database (`~/.cloakclaw/mappings.db`)
- Each cloaking session gets a UUID
- Maps: `session_id, original, replacement, entity_type, timestamp`
- Never leaves the machine

### Replacement Strategy
- People → fake people names (from built-in list)
- Companies → fake company names (from built-in list)  
- Emails → fake emails (@example.com)
- Phone numbers → 555-XXX-XXXX format
- Dollar amounts → proportionally scaled (maintain ratios but change values)
- Dates → shifted by consistent random offset (preserve intervals)
- API keys/tokens → [REDACTED_API_KEY_1], [REDACTED_API_KEY_2]
- Addresses → fake addresses
- Account numbers → randomized same-format numbers
- Custom entities → [ENTITY_TYPE_N] format

### Consistency
Within a single session, the SAME original always maps to the SAME replacement. "John Smith" always becomes "Michael Chen" (or whatever) throughout the entire document. This is critical for LLM comprehension.

## CLI Interface

```bash
# Basic: cloak a file
cloakclaw cloak document.txt --profile legal

# Cloak from stdin
cat document.txt | cloakclaw cloak --profile financial

# Cloak and send to clipboard
cloakclaw cloak document.txt --profile email --copy

# De-cloak a response (paste or pipe)
cloakclaw decloak --session <session-id>
# Then paste the LLM response, Ctrl+D to finish

# De-cloak from file
cloakclaw decloak --session <session-id> --file response.txt

# Interactive mode (shows proposed cloaks, asks for approval)
cloakclaw cloak document.txt --profile legal --interactive

# Show diff (what was cloaked)
cloakclaw diff --session <session-id>

# List recent sessions
cloakclaw sessions

# Show session details
cloakclaw session <session-id>

# Config
cloakclaw config set ollama.model qwen2.5:7b
cloakclaw config set ollama.url http://localhost:11434
```

## Document Profiles (MVP — 3 profiles)

### Legal
Entities: person names, company names, addresses, dollar amounts, dates, case numbers, terms/conditions specifics, jurisdiction references

### Financial  
Entities: person names, company names, account numbers, dollar amounts, percentages, revenue/profit figures, dates, bank names, investment amounts

### Email
Entities: person names, email addresses, phone numbers, company names, deal specifics, dollar amounts, dates, internal project names

## Config File
`~/.cloakclaw/config.yaml`:
```yaml
ollama:
  url: http://localhost:11434
  model: qwen2.5:7b
profiles:
  # users can customize built-in profiles or add new ones
```

## Dependencies (keep minimal)
- `better-sqlite3` — SQLite bindings
- `commander` — CLI framework
- `chalk` — terminal colors
- `yaml` — config parsing
- `uuid` — session IDs
- `diff` — for diff viewer
- `clipboardy` — clipboard support

## Tech Stack
- Node.js (ES modules)
- No build step needed
- `bin` entry in package.json → `cloakclaw` command
- Install via: `npm install -g cloakclaw`

## File Structure
```
app/
├── package.json
├── bin/
│   └── cloakclaw.js          # CLI entry point
├── src/
│   ├── index.js              # Main exports
│   ├── cloaker.js            # Core cloaking engine
│   ├── decloaker.js          # Reverse cloaking
│   ├── ner/
│   │   ├── regex-pass.js     # Fast regex NER
│   │   └── llm-pass.js       # Ollama contextual NER
│   ├── profiles/
│   │   ├── legal.js
│   │   ├── financial.js
│   │   └── email.js
│   ├── replacements/
│   │   ├── generator.js      # Fake data generation
│   │   └── data.js           # Name lists, fake companies, etc.
│   ├── store/
│   │   └── sqlite.js         # SQLite mapping store
│   ├── config.js             # Config management
│   └── diff.js               # Diff viewer
├── test/
│   ├── fixtures/             # Sample documents
│   │   ├── legal-sample.txt
│   │   ├── financial-sample.txt
│   │   └── email-sample.txt
│   └── cloaker.test.js       # Tests
└── README.md
```

## Key Design Decisions
1. **No GLiNER2 for MVP** — regex + Ollama is simpler. GLiNER2 can be added as an optimization later.
2. **Proportional number scaling** — dollar amounts get multiplied by a consistent random factor (0.5-2.0) so the LLM can still do math/analysis on them. The factor is stored in the session.
3. **Date shifting** — all dates shift by the same offset (e.g., +47 days) so time relationships are preserved.
4. **Interactive mode is optional** — default is auto-cloak with the profile's rules. `--interactive` shows each entity and asks.
5. **Ollama is optional** — tool works with regex-only if Ollama isn't running (degrades gracefully with a warning).
6. **No telemetry, no network calls** except to local Ollama.

## Test Fixtures
Include 3 realistic sample documents (with FAKE data, not real) that demonstrate each profile. These double as demos.

## Error Handling
- If Ollama not running → warn, proceed with regex-only
- If SQLite fails → fatal error (can't guarantee reversibility)
- If unknown profile → list available profiles
- If no session found for decloak → helpful error with `cloakclaw sessions` hint

## Output
- Cloaked text goes to stdout by default (pipe-friendly)
- `--copy` puts it on clipboard
- `--output file.txt` writes to file
- Session info printed to stderr (so stdout stays clean for piping)
- Colors/formatting only on TTY (not when piped)

Build this as a working, installable npm package. Make it good — this is going to be a real product.
