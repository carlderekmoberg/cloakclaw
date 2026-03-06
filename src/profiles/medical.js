export const medicalProfile = {
  name: 'medical',
  description: 'Medical records, prescriptions, insurance docs, HIPAA-sensitive',
  entityTypes: [
    'person', 'company', 'medical_id', 'ssn', 'date', 'address',
    'phone', 'email', 'dollar', 'account', 'drivers_license',
  ],
  llmTypes: ['person', 'company'],
};
