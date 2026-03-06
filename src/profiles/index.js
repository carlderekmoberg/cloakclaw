import { legalProfile } from './legal.js';
import { financialProfile } from './financial.js';
import { emailProfile } from './email.js';

export const profiles = {
  legal: legalProfile,
  financial: financialProfile,
  email: emailProfile,
};

export function getProfile(name) {
  const profile = profiles[name];
  if (!profile) {
    const available = Object.keys(profiles).join(', ');
    throw new Error(`Unknown profile "${name}". Available: ${available}`);
  }
  return profile;
}

export function listProfiles() {
  return Object.values(profiles);
}
