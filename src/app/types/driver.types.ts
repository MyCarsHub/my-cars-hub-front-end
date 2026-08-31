export type DriverStatus = 'AVAILABLE' | 'WORKING' | 'SUSPENDED';

export type LicenseCategory =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'AB' | 'AC' | 'AD' | 'AE';

export type DocumentType = 'CPF' | 'CNPJ';

export interface AddressPayload {
  street: string;
  number: string | null;
  complement: string | null;
  district: string;
  cep: string;
  city: string;
  uf: string;
}

export interface ContactPayload {
  email: string;
  phone: string;
}

export interface DocumentInputPayload {
  type: DocumentType;
  value: string;
}

/**
 * Contato de terceiro do motorista (FEAT-0066/0067) — referência de emergência
 * ou aval, não é o contato do próprio motorista.
 *
 * Contrato do backend: viaja DENTRO do POST /drivers (não é chamada separada),
 * máximo 3 por motorista (o servidor devolve 400 no 4º) e a ordem de exibição
 * É a ordem do array — o servidor preserva a ordem enviada.
 */
export interface ThirdPartyContact {
  fullName: string;
  phone: string;
}

/** Teto do servidor para `thirdPartyContacts` — o 4º é 400. */
export const MAX_THIRD_PARTY_CONTACTS = 3;

export interface DriverListItem {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  licenseNumber: string;
  licenseCategory: LicenseCategory;
  licenseExpiry: string;
  status: DriverStatus;
}

export interface DriverResponse {
  id: string;
  createdDate: string;
  modifyDate: string | null;
  companyId: string;
  userId: string | null;
  name: string;
  rg: string | null;
  document: { type: DocumentType | null; value: string | null };
  address: AddressPayload;
  contact: ContactPayload;
  licenseNumber: string;
  licenseCategory: LicenseCategory;
  licenseExpiry: string;
  status: DriverStatus;
  /**
   * Motorista de aplicativo (FEAT-0034, migration V69).
   *
   * A chave JSON é mesmo `isAppDriver`. O Jackson costuma comer o prefixo `is`
   * de acessor boolean, e um rename silencioso para `appDriver` faria todo
   * portão que lê este campo cair em `undefined` — o contrato está fixado por
   * teste de duas vias no backend.
   *
   * Tipado como `boolean` porque é o que um backend ATUAL devolve. Só que em
   * PRODUÇÃO o campo ainda não existe: o `main` do backend está congelado antes
   * da V69, então o JSON chega SEM a chave e o valor real é `undefined`, não
   * `false`. Quem lê este campo tem de falhar FECHADO — comparar com `=== true`,
   * nunca confiar na truthiness de um opcional.
   */
  isAppDriver: boolean;
  /**
   * Sempre uma LISTA, nunca `null` (contrato do backend, FEAT-0066), na ordem
   * em que foi enviada. Vazia quando o motorista não tem contatos de terceiros.
   */
  thirdPartyContacts: ThirdPartyContact[];
}

export interface CreateDriverRequest {
  name: string;
  userId: string | null;
  rg?: string | null;
  document: DocumentInputPayload;
  address: AddressPayload;
  contact: ContactPayload;
  licenseNumber: string;
  licenseCategory: LicenseCategory;
  licenseExpiry: string;
  status: DriverStatus;
  /** Máx. 3, na ordem de exibição. Ver `ThirdPartyContact`. Só no CREATE. */
  thirdPartyContacts: ThirdPartyContact[];
}

export interface UpdateDriverRequest {
  name: string;
  userId: string | null;
  rg?: string | null;
  address: AddressPayload;
  contact: ContactPayload;
  licenseNumber: string;
  licenseCategory: LicenseCategory;
  licenseExpiry: string;
  status: DriverStatus;
}

export interface DriverFilters {
  name?: string;
  status?: DriverStatus;
  licenseCategory?: LicenseCategory;
  licenseExpiryBefore?: string;
  sort?: 'name_asc' | 'name_desc' | 'license_expiry_asc' | 'license_expiry_desc' | 'created_desc' | 'created_asc';
  page?: number;
  size?: number;
  /**
   * Filtro do picker de "novo aluguel": quando `true`, o backend exclui
   * motoristas já vinculados a rentals RESERVED/ACTIVE do tenant.
   */
  availableForRental?: boolean;
  /**
   * Modo edição do rental: inclui o motorista do rental sendo editado mesmo
   * que ele esteja em uso (escape hatch para não sumir da lista).
   */
  includeCurrentRentalId?: string;
  /**
   * Período pretendido (`yyyy-MM-dd`) do aluguel sendo montado. Só tem efeito
   * junto de `availableForRental` — com ele, o backend esconde apenas os
   * motoristas que COLIDEM com esse intervalo, liberando quem está dirigindo
   * hoje para uma reserva futura.
   *
   * Contrato do backend: mande os DOIS ou NENHUM — só uma das pontas é 400.
   * `periodEnd` é INCLUSIVO e não pode ser anterior a `periodStart`.
   */
  periodStart?: string;
  /** Fim do período pretendido, INCLUSIVO. Ver `periodStart`. */
  periodEnd?: string;
}

// ------------------------------------------------------- anexos do motorista

/**
 * Espelha `DriverDocumentKindEnum` (FEAT-0033).
 *
 * `CNH` é UM tipo, não FRENTE/VERSO: a tabela aceita N linhas do mesmo kind,
 * então frente e verso da CNH são simplesmente dois arquivos `CNH`. Não existe
 * unicidade por tipo.
 */
export type DriverDocumentKind =
  | 'CNH'
  | 'ADDRESS_PROOF'
  | 'INCOME_PROOF'
  | 'APP_RIDE_RECEIPT'
  | 'OTHER';

/** Espelha `DriverDocumentDto`. Sem `storagePath`: o bucket é privado. */
export interface DriverDocument {
  id: string;
  driverId: string;
  kind: DriverDocumentKind;
  kindLabel: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdDate: string;
}

/** Espelha `DriverDocumentUrlDto` — URL assinada de TTL curto. */
export interface DriverDocumentUrl {
  url: string;
  expiresInSeconds: number;
}

/** Rótulos do backend (`DriverDocumentKindEnum.label`), em pt-BR. */
export const DRIVER_DOCUMENT_KIND_META: Record<DriverDocumentKind, string> = {
  CNH: 'CNH',
  ADDRESS_PROOF: 'Comprovante de residência',
  INCOME_PROOF: 'Comprovante de renda',
  APP_RIDE_RECEIPT: 'Extrato de aplicativo',
  OTHER: 'Outro',
};

export const DRIVER_DOCUMENT_KIND_OPTIONS: ReadonlyArray<{
  value: DriverDocumentKind;
  label: string;
}> = (Object.keys(DRIVER_DOCUMENT_KIND_META) as DriverDocumentKind[]).map((value) => ({
  value,
  label: DRIVER_DOCUMENT_KIND_META[value],
}));
