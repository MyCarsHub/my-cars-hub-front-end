export interface OnboardingData {
  name?: string;
  cpf?: string;
  phone?: string;
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
  { step: 1, title: 'Dados Pessoais', icon: '👤', subtitle: 'Como devemos te chamar?' },
  { step: 2, title: 'Empresa', icon: '🏢', subtitle: 'Informações da sua organização' },
  { step: 3, title: 'Documento', icon: '📋', subtitle: 'CNPJ da empresa (opcional)' },
  { step: 4, title: 'Bem-vindo', icon: '🎉', subtitle: 'Pronto para começar!' },
] as const;

export const TOTAL_STEPS = STEP_CONFIGS.length;
