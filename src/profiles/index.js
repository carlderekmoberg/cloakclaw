import { legalProfile } from './legal.js';
import { financialProfile } from './financial.js';
import { emailProfile } from './email.js';
import { codeProfile } from './code.js';
import { medicalProfile } from './medical.js';
import { generalProfile } from './general.js';

export const profiles = {
  legal: legalProfile,
  financial: financialProfile,
  email: emailProfile,
  code: codeProfile,
  medical: medicalProfile,
  general: generalProfile,
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
