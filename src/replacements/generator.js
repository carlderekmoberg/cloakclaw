import {
  PERSON_NAMES, COMPANY_NAMES, STREET_NAMES, CITIES,
  EMAIL_DOMAINS, BANK_NAMES, JURISDICTION_NAMES,
} from './data.js';

/**
 * Generates consistent fake replacements for entities.
 * Same original → same replacement within a session.
 */
export class ReplacementGenerator {
  constructor(opts = {}) {
    this.used = new Map();       // entityType → Set of used indices
    this.mapped = new Map();     // original → replacement
    this.counters = new Map();   // entityType → counter for fallback
    this.numberScaleFactor = opts.numberScaleFactor || (0.5 + Math.random() * 1.5);
    this.dateShiftDays = opts.dateShiftDays || Math.floor(Math.random() * 180) - 90;
  }

  generate(original, entityType) {
    const key = `${entityType}::${original}`;
    if (this.mapped.has(key)) return this.mapped.get(key);

    let replacement;
    switch (entityType) {
      case 'person':
        replacement = this._pickFromList(PERSON_NAMES, 'person') || `Person_${this._counter('person')}`;
        break;
      case 'company':
        replacement = this._pickFromList(COMPANY_NAMES, 'company') || `Company_${this._counter('company')}`;
        break;
      case 'address':
        replacement = this._generateAddress();
        break;
      case 'email':
        replacement = this._generateEmail(original);
        break;
      case 'phone':
        replacement = this._generatePhone();
        break;
      case 'dollar':
        replacement = this._scaleDollar(original);
        break;
      case 'date':
        replacement = this._shiftDate(original);
        break;
      case 'ssn':
        replacement = this._generateSSN();
        break;
      case 'account':
        replacement = this._generateAccount(original);
        break;
      case 'api_key':
        replacement = `[REDACTED_KEY_${this._counter('api_key')}]`;
        break;
      case 'url':
        replacement = `https://internal-${this._counter('url')}.example.com`;
        break;
      case 'case_number':
        replacement = `Case No. ${2024 + Math.floor(Math.random() * 3)}-CV-${String(Math.floor(Math.random() * 90000) + 10000)}`;
        break;
      case 'jurisdiction':
        replacement = this._pickFromList(JURISDICTION_NAMES, 'jurisdiction') || `Jurisdiction_${this._counter('jurisdiction')}`;
        break;
      case 'bank':
        replacement = this._pickFromList(BANK_NAMES, 'bank') || `Bank_${this._counter('bank')}`;
        break;
      case 'percentage':
        replacement = this._scalePercentage(original);
        break;
      default:
        replacement = `[${entityType.toUpperCase()}_${this._counter(entityType)}]`;
    }

    this.mapped.set(key, replacement);
    return replacement;
  }

  _pickFromList(list, type) {
    if (!this.used.has(type)) this.used.set(type, new Set());
    const usedSet = this.used.get(type);
    for (let i = 0; i < list.length; i++) {
      if (!usedSet.has(i)) {
        usedSet.add(i);
        return list[i];
      }
    }
    return null;
  }

  _counter(type) {
    const c = (this.counters.get(type) || 0) + 1;
    this.counters.set(type, c);
    return c;
  }

  _generateEmail(original) {
    const domain = EMAIL_DOMAINS[this._counter('email') % EMAIL_DOMAINS.length];
    const localPart = original.includes('@')
      ? original.split('@')[0].replace(/[^a-z]/gi, '').slice(0, 5).toLowerCase()
      : 'user';
    return `${localPart}${this._counter('email_n')}@${domain}`;
  }

  _generatePhone() {
    const area = 555;
    const mid = String(Math.floor(Math.random() * 900) + 100);
    const end = String(Math.floor(Math.random() * 9000) + 1000);
    return `(${area}) ${mid}-${end}`;
  }

  _generateAddress() {
    const street = STREET_NAMES[this._counter('addr_s') % STREET_NAMES.length];
    const city = CITIES[this._counter('addr_c') % CITIES.length];
    return `${street}, ${city}`;
  }

  _scaleDollar(original) {
    const cleaned = original.replace(/[$,\s]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return `$${this._counter('dollar')},000`;
    const scaled = num * this.numberScaleFactor;
    // Preserve format
    if (original.includes('.')) {
      return '$' + scaled.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    return '$' + Math.round(scaled).toLocaleString('en-US');
  }

  _scalePercentage(original) {
    const num = parseFloat(original.replace(/[%\s]/g, ''));
    if (isNaN(num)) return `${this._counter('pct')}%`;
    // Scale percentages more gently — keep them reasonable
    const scaled = Math.min(99.9, Math.max(0.1, num * (0.7 + Math.random() * 0.6)));
    return scaled.toFixed(1) + '%';
  }

  _shiftDate(original) {
    // Try to parse common date formats
    const parsed = new Date(original);
    if (isNaN(parsed.getTime())) return original; // Can't parse, return as-is

    parsed.setDate(parsed.getDate() + this.dateShiftDays);

    // Try to match original format
    if (/\d{4}-\d{2}-\d{2}/.test(original)) {
      return parsed.toISOString().split('T')[0];
    }
    if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(original)) {
      return `${parsed.getMonth() + 1}/${parsed.getDate()}/${parsed.getFullYear()}`;
    }
    if (/[A-Z][a-z]+ \d{1,2},? \d{4}/.test(original)) {
      return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }
    return parsed.toLocaleDateString('en-US');
  }

  _generateSSN() {
    const a = String(Math.floor(Math.random() * 900) + 100);
    const b = String(Math.floor(Math.random() * 90) + 10);
    const c = String(Math.floor(Math.random() * 9000) + 1000);
    return `${a}-${b}-${c}`;
  }

  _generateAccount(original) {
    // Generate same-length random digits
    const len = original.replace(/\D/g, '').length || 10;
    let acct = '';
    for (let i = 0; i < len; i++) {
      acct += Math.floor(Math.random() * 10);
    }
    // Preserve formatting (dashes, spaces)
    if (original.includes('-')) {
      return acct.match(/.{1,4}/g).join('-');
    }
    if (original.includes(' ')) {
      return acct.match(/.{1,4}/g).join(' ');
    }
    return acct;
  }
}
