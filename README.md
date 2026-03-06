# 🦀 CloakClaw

**Local AI privacy proxy** — automatically redact sensitive data before sending documents to cloud LLMs, then restore originals in responses.

Your data never leaves your machine. Zero cloud dependency for cloaking.

## What It Does

```
📄 Your Document          →  🔒 Cloaked Version         →  ☁️ Cloud LLM
"Carl Moberg, CEO of         "James Park, CEO of           (sees only
 Streakwave Wireless,         Northstar Solutions,          fake data)
 SSN 487-23-9156"             SSN 969-63-3159"

☁️ LLM Response           →  🔓 Decloaked Response      →  📄 Original Names Back
"James Park should            "Carl Moberg should
 consider..."                  consider..."
```

## Install

```bash
# Requires Node.js 22+ and Ollama (for AI-powered detection)
npm install -g cloakclaw

# Optional: install poppler for better PDF extraction
brew install poppler  # macOS
apt install poppler-utils  # Linux
```

## Quick Start

```bash
# Cloak a document
cloakclaw cloak contract.pdf --profile legal > cloaked.txt

# See what was replaced
cloakclaw diff -s <session-id>

# Send cloaked.txt to your LLM... get response... save as response.txt

# Restore originals
cloakclaw decloak -s <session-id> -f response.txt
```

## Web UI

```bash
cloakclaw serve
# Open http://localhost:3900
```

Drag-and-drop files, paste text, toggle entity types, view session history.

## Features

### 24 Entity Types
| Category | Types |
|----------|-------|
| **Identity** | People, Companies, Passports, Drivers License |
| **Contact** | Emails, Phones, Addresses |
| **Financial** | Dollars, Percentages, Accounts, Banks, SSNs |
| **Legal** | Case Numbers, Jurisdictions |
| **Tech** | IP Addresses, MAC Addresses, Passwords/Secrets, API Keys, URLs |
| **Other** | Crypto Wallets, GPS Coordinates, VIN Numbers, Medical IDs, Dates |

### 6 Document Profiles
- 🛡️ **General** — all 24 types (catch-all)
- 📜 **Legal** — contracts, NDAs, filings
- 💰 **Financial** — bank statements, P&L, investor docs
- ✉️ **Email** — correspondence
- 💻 **Code** — .env files, configs, infrastructure docs
- 🏥 **Medical** — HIPAA-adjacent use cases

### Two-Pass Detection
1. **Regex pass** — fast pattern matching (SSNs, emails, IPs, etc.)
2. **LLM pass** — Ollama-powered contextual detection (names, companies, ambiguous entities)

Works without Ollama (regex-only mode), but LLM pass catches significantly more.

### Security
- 🔐 **AES-256-GCM encrypted** mapping database
- 🔑 **Optional password protection** (scrypt-derived key)
- 📁 Encryption key: `~/.cloakclaw/encryption.key` (chmod 600)
- ♻️ **Auto-expiry** — sessions purged after 7 days
- 📏 **50MB upload limit**
- 🚫 **Zero telemetry** — nothing phones home, ever

## CLI Reference

```bash
cloakclaw cloak [file]           # Cloak a file or stdin
  -p, --profile <name>           # Profile: general|legal|financial|email|code|medical
  -i, --interactive              # Approve each entity
  --no-llm                       # Skip Ollama LLM pass
  -o, --output <file>            # Write to file
  -c, --copy                     # Copy to clipboard

cloakclaw decloak                # Restore originals
  -s, --session <id>             # Session ID from cloak
  -f, --file <file>              # Read from file (or stdin)

cloakclaw diff -s <id>           # Show entity mapping table
cloakclaw sessions               # List recent sessions
cloakclaw session <id>           # Session details

cloakclaw password status        # Check if password-protected
cloakclaw password set           # Set database password
cloakclaw password remove        # Remove password

cloakclaw config show            # Show current config
cloakclaw config set <key> <val> # Set config value
cloakclaw serve                  # Start web UI (default :3900)
```

## Configuration

Config stored at `~/.cloakclaw/config.yaml`:

```yaml
ollama:
  url: http://localhost:11434
  model: qwen2.5:7b        # or any Ollama model
```

### Recommended Models
| RAM | Model | Detection Quality |
|-----|-------|-------------------|
| 8GB | `qwen2.5:3b` | Basic (regex carries most weight) |
| 16GB | `qwen2.5:7b` | Good |
| 32GB+ | `qwen2.5:32b` | Very good |
| 64GB+ | `qwen2.5:72b` | Excellent |

## OpenClaw Skill

CloakClaw is available as an [OpenClaw](https://github.com/openclaw/openclaw) skill:

```bash
openclaw skill install cloakclaw
```

When installed, documents sent to your agent are automatically cloaked before reaching cloud LLMs, with a `🔒 CloakClaw: N entities protected` footer.

## How It Works

1. **Extract** — PDF text extraction via poppler (`pdftotext`), with pdfjs-dist fallback
2. **Detect** — Two-pass NER: regex patterns → Ollama LLM contextual analysis
3. **Replace** — Generate realistic fake data (consistent within session)
4. **Store** — Encrypted SQLite mapping (original ↔ replacement)
5. **Decloak** — Reverse substitution using session mappings

Replacements are realistic: dollar amounts scale proportionally, dates shift consistently, names get plausible alternatives, account numbers keep the same format.

## ⚠️ Disclaimer

**CloakClaw is NOT HIPAA, GDPR, SOC 2, PCI-DSS, or CCPA compliant.** It is a best-effort privacy tool that may miss entities or produce false positives. You are solely responsible for reviewing cloaked output. See [full disclaimer](https://cloakclaw.com).

## License

MIT
