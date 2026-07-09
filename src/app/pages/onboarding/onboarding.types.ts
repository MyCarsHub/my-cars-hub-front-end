export interface OnboardingData {
  name?: string;
  cpf?: string;
  phoneNumber?: string;
  companyName?: string;
  hasCnpj?: boolean;
  cnpj?: string;
  plan?: string;
}

export interface OnboardingState {
  step: number;
  isCompleted: boolean;
  data: OnboardingData;
}

export interface OnboardingStepPayload {
  step: number;
  data: OnboardingData;
}

export const STEP_CONFIGS = [
  { step: 1, title: 'Dados Pessoais', subtitle: 'Como devemos te chamar?' },
  { step: 2, title: 'Empresa', subtitle: 'Informações da sua organização' },
  { step: 3, title: 'Documento', subtitle: 'CNPJ da empresa (opcional)' },
  { step: 4, title: 'Bem-vindo', subtitle: 'Pronto para começar!' },
] as const;

export const TOTAL_STEPS = STEP_CONFIGS.length;
