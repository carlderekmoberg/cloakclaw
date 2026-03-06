/**
 * Fast regex-based NER pass.
 * Returns array of { match, start, end, type } objects.
 */

const PATTERNS = [
  // SSN (must be before phone to avoid conflicts)
  { type: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g },

  // API keys / tokens (long alphanumeric strings, often with prefixes)
  { type: 'api_key', regex: /\b(?:sk|pk|api|token|key|secret|bearer)[_-]?[A-Za-z0-9_-]{20,}\b/gi },
  { type: 'api_key', regex: /\b[A-Za-z0-9]{32,}\b/g, minContext: true }, // long hex/base64 strings

  // Email addresses
  { type: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },

  // Phone numbers (various formats)
  { type: 'phone', regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },

  // Dollar amounts
  { type: 'dollar', regex: /\$[\d,]+(?:\.\d{2})?\b/g },
  { type: 'dollar', regex: /(?:USD|US\$)\s?[\d,]+(?:\.\d{2})?\b/g },

  // Percentages
  { type: 'percentage', regex: /\b\d+(?:\.\d+)?%/g },

  // Account numbers (8+ digits, possibly with dashes/spaces)
  { type: 'account', regex: /\b(?:account|acct|routing|aba|brokerage|portfolio|policy|member|client|customer|invoice|ref|reference)[\s#:]*\d[\d\s-]{7,}\b/gi },

  // Credit card numbers (13-19 digits, possibly with dashes/spaces)
  { type: 'account', regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g },

  // EIN / Tax ID (XX-XXXXXXX format)
  { type: 'account', regex: /\b(?:EIN|Tax\s*ID|TIN)[\s#:]*\d{2}-\d{7}\b/gi },
  { type: 'account', regex: /\b\d{2}-\d{7}\b/g, minContext: true },

  // Case numbers
  { type: 'case_number', regex: /\b(?:Case|Docket|File)\s*(?:No\.?|Number|#)\s*[\w-]+\b/gi },

  // IP addresses (v4)
  { type: 'ip_address', regex: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?::\d{1,5})?\b/g },

  // MAC addresses
  { type: 'mac_address', regex: /\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/g },
  { type: 'mac_address', regex: /\b[0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){5}\b/g },

  // Passwords / secrets (key=value patterns)
  { type: 'password', regex: /(?:password|passwd|pwd|secret|token|api[_-]?key|auth[_-]?token|access[_-]?key|private[_-]?key|client[_-]?secret)[\s]*[:=]\s*['"]?[^\s'"]{4,}['"]?/gi },

  // Environment variables with secrets
  { type: 'password', regex: /(?:DB_PASSWORD|DB_PASS|DATABASE_URL|REDIS_URL|MONGO_URI|SECRET_KEY|JWT_SECRET|ENCRYPTION_KEY|AWS_SECRET|PRIVATE_KEY)[\s]*=\s*['"]?[^\s'"]+['"]?/gi },

  // Connection strings
  { type: 'password', regex: /(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s]+/gi },

  // Crypto wallet addresses (Bitcoin, Ethereum)
  { type: 'crypto_wallet', regex: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g },  // Bitcoin
  { type: 'crypto_wallet', regex: /\b0x[0-9a-fA-F]{40}\b/g },                  // Ethereum
  { type: 'crypto_wallet', regex: /\bbc1[a-zA-HJ-NP-Z0-9]{39,59}\b/g },       // Bitcoin bech32

  // GPS coordinates
  { type: 'gps', regex: /[-+]?\d{1,3}\.\d{4,8}\s*,\s*[-+]?\d{1,3}\.\d{4,8}/g },

  // VIN numbers (17 alphanumeric, no I/O/Q)
  { type: 'vin', regex: /\b[A-HJ-NPR-Z0-9]{17}\b/g },

  // Passport numbers (common formats)
  { type: 'passport', regex: /\b(?:passport|travel\s*doc)[\s#:]*[A-Z0-9]{6,12}\b/gi },

  // Driver's license (keyword + alphanumeric)
  { type: 'drivers_license', regex: /\b(?:driver'?s?\s*licen[cs]e|DL|DMV)[\s#:]*[A-Z0-9]{5,15}\b/gi },

  // Medical record numbers
  { type: 'medical_id', regex: /\b(?:MRN|medical\s*record|patient\s*id|health\s*id|member\s*id|NPI|DEA)[\s#:]*[A-Z0-9]{5,15}\b/gi },

  // URLs (internal or suspicious)
  { type: 'url', regex: /https?:\/\/(?!(?:www\.)?(?:google|github|stackoverflow|wikipedia|example)\.)[\w.-]+(?::\d+)?(?:\/[^\s)]*)?/g },

  // Dates (multiple formats)
  { type: 'date', regex: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/g },
  { type: 'date', regex: /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g },
  { type: 'date', regex: /\b\d{4}-\d{2}-\d{2}\b/g },
];

/**
 * Run regex NER on text.
 * @param {string} text
 * @param {string[]} entityTypes - which types to look for (from profile)
 * @returns {Array<{match: string, start: number, end: number, type: string}>}
 */
export function regexPass(text, entityTypes = null) {
  const results = [];
  const seen = new Set(); // dedupe overlapping matches

  for (const { type, regex, minContext } of PATTERNS) {
    if (entityTypes && !entityTypes.includes(type)) continue;

    // Reset regex state
    const re = new RegExp(regex.source, regex.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const match = m[0];
      const start = m.index;
      const end = start + match.length;

      // Skip very short matches for context-sensitive patterns
      if (minContext && match.length < 32) continue;

      // Dedupe: skip if this span overlaps with a higher-priority match
      const key = `${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({ match, start, end, type });
    }
  }

  // Sort by position (earliest first), then by length (longest first for same start)
  results.sort((a, b) => a.start - b.start || b.end - a.end);

  // Remove overlaps (keep first/longest)
  const filtered = [];
  let lastEnd = -1;
  for (const r of results) {
    if (r.start >= lastEnd) {
      filtered.push(r);
      lastEnd = r.end;
    }
  }

  return filtered;
}
