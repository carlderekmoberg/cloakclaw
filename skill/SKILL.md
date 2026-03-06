---
name: cloakclaw
description: >
  Automatic privacy proxy for AI conversations. Redacts sensitive data (names, companies,
  financials, SSNs, emails, phones, addresses, API keys) from documents before sending to
  cloud LLMs, then restores originals in the response. Use when: (1) user attaches a document
  (PDF, TXT, etc.), (2) user pastes sensitive text, (3) user mentions contracts, financials,
  HR docs, or legal documents, (4) user explicitly asks for privacy/cloaking. Always-on by
  default — documents are auto-cloaked with no user action needed. Requires Ollama running
  locally for name/company detection. Works without Ollama in regex-only mode.
---

# CloakClaw — Always-On Privacy Proxy

## How It Works

1. **Detect**: When user sends a document or sensitive text, auto-detect the document type
2. **Cloak**: Run the cloaking engine (regex + local LLM) to replace sensitive entities with realistic fakes
3. **Send**: Forward cloaked text to the cloud LLM for analysis
4. **Decloak**: When response arrives, reverse all replacements to restore originals
5. **Deliver**: Send the restored response to user with a privacy footer

## Setup Check

Before first use, verify CloakClaw is installed:

```bash
node /path/to/cloakclaw/app/bin/cloakclaw.js --version
```

If Ollama is available, names and companies get detected. Without Ollama, regex-only mode still catches emails, phones, SSNs, dollars, dates, API keys.

## Auto-Detection Rules

**Always cloak (document attached):**
- PDF, DOCX, TXT files → auto-detect profile from content
- Legal keywords (agreement, contract, whereas, hereby) → `legal` profile
- Financial keywords (revenue, P&L, balance sheet, quarterly) → `financial` profile
- Default for emails/messages → `email` profile

**Always cloak (sensitive content in text):**
- Contains SSN patterns (###-##-####)
- Contains dollar amounts > $1,000
- Contains multiple proper names + company names
- User explicitly says "cloak", "private", "redact", or "protect"

**Skip cloaking:**
- Simple questions with no sensitive data
- Code-only messages (unless they contain credentials)
- User says "raw", "uncloak", or "no cloak"

## Execution Flow

### Step 1: Cloak the document

Run the cloaking script:

```bash
node scripts/cloak.js --profile <legal|financial|email> --input /path/to/file_or_text
```

The script outputs JSON:
```json
{
  "sessionId": "uuid",
  "cloaked": "...cloaked text...",
  "entityCount": 14,
  "mappings": [{"original": "...", "replacement": "...", "type": "..."}]
}
```

### Step 2: Send cloaked text to cloud LLM

Use the cloaked text as the document content in your prompt to the cloud model. The user's original question/instruction stays unchanged — only the document data is cloaked.

### Step 3: Decloak the response

```bash
node scripts/decloak.js --session <sessionId> --input /path/to/response
```

### Step 4: Deliver with privacy footer

Append to the response:

```
🔒 CloakClaw: {entityCount} entities protected | Profile: {profile} | Session: {sessionId_short}
```

## User Commands

- `cloakclaw off` — disable auto-cloaking for this session
- `cloakclaw on` — re-enable auto-cloaking
- `cloakclaw status` — show current settings and recent sessions
- `cloakclaw diff <sessionId>` — show what was cloaked in a specific session

## Configuration

Config stored at `~/.cloakclaw/config.yaml`:

```yaml
ollama:
  url: http://localhost:11434    # or remote Ollama instance
  model: qwen2.5:7b             # model for name/company detection
auto_cloak: true                 # always-on by default
default_profile: email           # fallback profile
```

## Profile Selection Heuristics

Scan first 500 chars of document:
- **Legal**: "agreement", "contract", "whereas", "hereby", "party", "witness", "jurisdiction"
- **Financial**: "revenue", "profit", "balance", "quarterly", "fiscal", "earnings", "P&L"
- **Email**: "from:", "to:", "subject:", "cc:", "regards", "sincerely"
- **Default**: `email` (catches most entity types)
