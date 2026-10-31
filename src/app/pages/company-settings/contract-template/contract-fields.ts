import { FIELD_LABELS, fieldLabel } from './ai/contract-ai.messages';

/**
 * Catálogo dos campos do contrato para a tela. Os rótulos são os do fluxo com IA
 * (`FIELD_LABELS`, espelho do backend); aqui ficam o valor de EXEMPLO de cada campo, que o
 * contrato ao vivo mostra no modo «Com exemplo», e o rótulo em linguagem simples das
 * perguntas da IA.
 */

/** Um valor de exemplo para cada chave de `FIELD_LABELS` (o spec confere a cobertura). */
export const FIELD_EXAMPLES: Readonly<Record<string, string>> = {
  companyName: 'Locadora Exemplo Ltda',
  companyCnpj: '98.765.432/0001-10',
  companyPhone: '(11) 3333-4444',
  companyEmail: 'contato@locadoraexemplo.com.br',
  companyAddress: 'Av. Paulista, 1000, São Paulo/SP',
  companyCep: '01310-100',
  companyCity: 'São Paulo',
  companyRepresentative: 'Ana Lima',
  companyRepresentativeRole: 'sócia-administradora',
  driverName: 'João Pereira',
  driverCpf: '987.654.321-00',
  driverRg: '12.345.678-9',
  driverEmail: 'joao.pereira@email.com',
  driverPhone: '(11) 98888-7777',
  driverLicense: '09876543210',
  driverLicenseCategory: 'AB',
  driverLicenseExpiry: '15/08/2029',
  driverAddress: 'Rua Exemplo, 10, São Paulo/SP',
  driverCep: '04567-000',
  vehiclePlate: 'XYZ-9876',
  vehicleBrand: 'Fiat',
  vehicleModel: 'Argo 1.3',
  vehicleYear: '2024',
  vehicleColor: 'branca',
  vehicleChassi: '9BD358A4NPY000001',
  vehicleRenavam: '01234567890',
  vehicleMileage: '12.500',
  vehicleFuel: 'flex',
  rentalId: '2026-0142',
  contractDate: '01/11/2026',
  startDate: '01/11/2026',
  endDate: '01/05/2027',
  totalAmount: 'R$ 18.200,00',
  caucaoAmount: 'R$ 2.000,00',
  periodRate: 'R$ 700,00',
  billingFrequency: 'semanal',
  initialKm: '12.500',
  pickupDate: '01/11/2026',
  firstPaymentDate: '08/11/2026',
  dailyInterest: '0,33%',
  lateInterestPercent: '1,00% ao mês',
  lateInterestTerms: '1,00% ao mês sobre o valor devido',
  lateFine: '2%',
  franchiseKm: '3.000',
  returnFuelPolicy: 'tanque cheio',
  extraKmPrice: 'R$ 0,50',
  lateFineTerms:
    'multa de mora de 2,00% sobre o valor da parcela em atraso, cobrada uma única vez',
  kmTerms:
    'A franquia de quilometragem é de 300 km/dia, apurada de forma acumulada a cada período de cobrança. ' +
    'Cada km além da franquia custa R$ 0,50 e é cobrado junto com a parcela seguinte. ' +
    'A apuração considera a leitura do hodômetro registrada nas vistorias.',
};

/** Como a pergunta da IA chama cada campo (quem responde não conhece o nome técnico). */
const PLAIN_LABELS: Readonly<Record<string, string>> = {
  periodRate: 'O valor de cada pagamento',
  totalAmount: 'O valor total do aluguel',
  caucaoAmount: 'O valor da caução',
  startDate: 'O dia em que o aluguel começa',
  endDate: 'O dia em que o aluguel termina',
  contractDate: 'O dia em que o contrato foi assinado',
  pickupDate: 'O dia em que o motorista pega o carro',
  firstPaymentDate: 'O dia do primeiro pagamento',
  companyRepresentative: 'Quem assina pela locadora',
  companyName: 'O nome da locadora',
  driverName: 'O nome do motorista',
  initialKm: 'A quilometragem na entrega do carro',
  franchiseKm: 'O limite de quilometragem',
  lateFine: 'A multa por atraso',
  dailyInterest: 'Os juros por dia de atraso',
};

/** Como a pergunta chama o dado, por tipo. Nome e endereço não têm: vão em claro, entre aspas. */
const QUESTION_NOUNS: Readonly<Record<string, string>> = {
  CPF: 'este CPF',
  RG: 'este RG',
  CNH: 'esta CNH',
  CNPJ: 'este CNPJ',
  PHONE: 'este telefone',
  EMAIL: 'este e-mail',
  CEP: 'este CEP',
};

export function questionTitle(kind: string, value: string): string {
  return `De quem é ${QUESTION_NOUNS[kind] ?? `«${value}»`}?`;
}

/** Rótulo das marcas do texto mascarado (`[CPF_1]` → «CPF escondido»). */
const HIDDEN_LABELS: Readonly<Record<string, string>> = {
  EMPRESA: 'nome escondido',
  NOME: 'nome escondido',
  CNPJ: 'CNPJ escondido',
  CPF: 'CPF escondido',
  RG: 'RG escondido',
  CNH: 'CNH escondida',
  ENDERECO: 'endereço escondido',
  CEP: 'CEP escondido',
  EMAIL: 'e-mail escondido',
  TELEFONE: 'telefone escondido',
  PLACA: 'placa escondida',
  CHASSI: 'chassi escondido',
  RENAVAM: 'Renavam escondido',
};

export const MASK_TOKEN = /\[([A-Z]+)_\d+\]/g;

/** A chave como se digita no Word. Só o caminho «Já sei colocar os campos no Word» a mostra. */
export function fieldCode(field: string): string {
  return `{{${field}}}`;
}

/** Sem exemplo, cai no nome em português: a chave em inglês nunca aparece ao cliente. */
export function fieldExample(field: string): string {
  return FIELD_EXAMPLES[field] ?? fieldLabel(field);
}

export function plainFieldLabel(field: string, apiLabel?: string | null): string {
  return PLAIN_LABELS[field] ?? apiLabel?.trim() ?? FIELD_LABELS[field] ?? 'Campo do contrato';
}

export function hiddenLabel(kind: string): string {
  return HIDDEN_LABELS[kind] ?? 'dado escondido';
}

/** É um campo da lista fechada? Token fora dela o backend recusa ao salvar. */
export function isKnownField(field: string): boolean {
  return Object.hasOwn(FIELD_LABELS, field);
}

/** Todas as chaves conhecidas, na ordem do catálogo (para os seletores de correção). */
export const FIELD_KEYS: readonly string[] = Object.keys(FIELD_LABELS);
