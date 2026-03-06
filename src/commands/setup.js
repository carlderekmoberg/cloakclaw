import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getConfig, setConfig } from '../config.js';
import { setPassword, isPasswordProtected } from '../store/crypto.js';

const CONFIG_FILE = join(homedir(), '.cloakclaw', 'config.yaml');

function ask(rl, question) {
  return new Promise(r => rl.question(question, r));
}

async function probeOllama(url) {
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d.models || [];
  } catch {
    return null;
  }
}

export async function setupCommand() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('');
  console.log(chalk.cyan.bold('  🦀 CloakClaw Setup'));
  console.log(chalk.dim('  ─────────────────────────────────────'));
  console.log('');

  const isFirstRun = !existsSync(CONFIG_FILE);
  if (!isFirstRun) {
    console.log(chalk.dim('  Config exists at ~/.cloakclaw/config.yaml'));
    const proceed = await ask(rl, chalk.yellow('  Reconfigure? (y/N) '));
    if (proceed.toLowerCase() !== 'y') { rl.close(); return; }
  }

  // Step 1: Detect Ollama
  console.log('');
  console.log(chalk.bold('  Step 1: Ollama Connection'));
  console.log(chalk.dim('  Ollama runs the local AI model for detecting names & companies.'));
  console.log(chalk.dim('  CloakClaw works without it (regex-only), but catches more with it.'));
  console.log('');

  const defaultUrl = 'http://localhost:11434';
  const urls = [defaultUrl, 'http://127.0.0.1:11434'];

  let ollamaUrl = null;
  let models = null;

  // Try default URLs
  for (const url of urls) {
    process.stdout.write(chalk.dim(`  Checking ${url}... `));
    const found = await probeOllama(url);
    if (found) {
      console.log(chalk.green('✓ Connected'));
      ollamaUrl = url;
      models = found;
      break;
    }
    console.log(chalk.red('✗'));
  }

  if (!ollamaUrl) {
    const custom = await ask(rl, chalk.yellow('  Ollama URL (or Enter to skip): '));
    if (custom.trim()) {
      const found = await probeOllama(custom.trim());
      if (found) {
        ollamaUrl = custom.trim();
        models = found;
        console.log(chalk.green('  ✓ Connected'));
      } else {
        console.log(chalk.red('  ✗ Could not connect'));
      }
    }
  }

  let ollamaModel = 'qwen2.5:7b';
  if (ollamaUrl && models && models.length > 0) {
    console.log('');
    console.log(chalk.dim('  Available models:'));
    const recommended = ['qwen2.5:72b', 'qwen2.5:32b', 'qwen2.5:14b', 'qwen2.5:7b', 'qwen2.5:3b', 'qwen3.5:35b', 'llama3.3:70b'];
    const sorted = models.sort((a, b) => {
      const aIdx = recommended.findIndex(r => a.name.includes(r));
      const bIdx = recommended.findIndex(r => b.name.includes(r));
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return 0;
    });
    sorted.slice(0, 10).forEach((m, i) => {
      const size = m.size ? ` (${(m.size / 1e9).toFixed(1)}GB)` : '';
      const star = recommended.some(r => m.name.includes(r)) ? chalk.green(' ★') : '';
      console.log(chalk.dim(`  ${i + 1}. `) + m.name + chalk.dim(size) + star);
    });

    const choice = await ask(rl, chalk.yellow(`\n  Model name (default: ${sorted[0]?.name || ollamaModel}): `));
    ollamaModel = choice.trim() || sorted[0]?.name || ollamaModel;
  } else if (!ollamaUrl) {
    console.log('');
    console.log(chalk.yellow('  ⚡ Running in regex-only mode'));
    console.log(chalk.dim('  Install Ollama later: https://ollama.ai'));
    console.log(chalk.dim('  Then run: ollama pull qwen2.5:7b'));
  }

  // Step 2: Password
  console.log('');
  console.log(chalk.bold('  Step 2: Database Security'));
  console.log(chalk.dim('  CloakClaw encrypts all mappings with AES-256-GCM.'));
  console.log(chalk.dim('  Optionally set a password for extra protection.'));
  console.log('');

  if (!isPasswordProtected()) {
    const wantPw = await ask(rl, chalk.yellow('  Set a database password? (y/N) '));
    if (wantPw.toLowerCase() === 'y') {
      const pw = await ask(rl, '  Password (min 4 chars): ');
      const confirm = await ask(rl, '  Confirm: ');
      if (pw === confirm && pw.length >= 4) {
        setPassword(pw);
        console.log(chalk.green('  ✓ Password set'));
      } else {
        console.log(chalk.red('  ✗ Passwords don\'t match or too short. Skipped.'));
      }
    }
  } else {
    console.log(chalk.green('  🔒 Password already set'));
  }

  // Step 3: Web UI auth
  console.log('');
  console.log(chalk.bold('  Step 3: Web UI'));
  console.log(chalk.dim('  The dashboard runs at http://localhost:3900'));
  console.log(chalk.dim('  Optionally protect it with a token so only you can access it.'));
  console.log('');

  const wantUiAuth = await ask(rl, chalk.yellow('  Set a web UI access token? (y/N) '));
  let uiToken = '';
  if (wantUiAuth.toLowerCase() === 'y') {
    uiToken = await ask(rl, '  Token (or Enter to auto-generate): ');
    if (!uiToken.trim()) {
      const { randomBytes } = await import('node:crypto');
      uiToken = randomBytes(24).toString('hex');
      console.log(chalk.dim(`  Generated: ${uiToken}`));
    }
  }

  // Save config
  const config = {
    ollama: {
      url: ollamaUrl || defaultUrl,
      model: ollamaModel,
    },
  };
  if (uiToken) config.ui = { token: uiToken };

  setConfig(config);

  // Step 4: Test
  console.log('');
  console.log(chalk.bold('  Step 4: Quick Test'));
  const wantTest = await ask(rl, chalk.yellow('  Run a test cloak? (Y/n) '));
  if (wantTest.toLowerCase() !== 'n') {
    console.log(chalk.dim('  Cloaking sample text...'));
    try {
      const { Cloaker } = await import('../cloaker.js');
      const cloaker = new Cloaker({ useLlm: !!ollamaUrl });
      const sample = 'John Smith, CEO of Acme Corp (john@acme.com, SSN 123-45-6789), closed the $2,500,000 deal on March 15, 2025.';
      const result = await cloaker.cloak(sample, 'general');
      console.log('');
      console.log(chalk.dim('  Original:'));
      console.log('  ' + sample);
      console.log('');
      console.log(chalk.dim('  Cloaked:'));
      console.log('  ' + result.cloaked);
      console.log('');
      console.log(chalk.green(`  ✓ ${result.mappings.length} entities detected and replaced`));
      cloaker.close();
    } catch (e) {
      console.log(chalk.red(`  ✗ Test failed: ${e.message}`));
    }
  }

  // Done
  console.log('');
  console.log(chalk.dim('  ─────────────────────────────────────'));
  console.log(chalk.cyan.bold('  ✓ Setup complete!'));
  console.log('');
  console.log(chalk.dim('  Quick start:'));
  console.log('    cloakclaw cloak document.pdf --profile legal');
  console.log('    cloakclaw serve              # web UI at :3900');
  console.log('');

  rl.close();
}
