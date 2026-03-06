export const generalProfile = {
  name: 'general',
  description: 'Catch-all profile — detects every entity type',
  entityTypes: [
    'person', 'company', 'email', 'phone', 'dollar', 'date', 'ssn',
    'account', 'address', 'url', 'api_key', 'ip_address', 'mac_address',
    'password', 'crypto_wallet', 'gps', 'vin', 'passport',
    'drivers_license', 'medical_id', 'case_number', 'jurisdiction',
    'bank', 'percentage',
  ],
  llmTypes: ['person', 'company', 'bank', 'jurisdiction'],
};
