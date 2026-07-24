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
}
