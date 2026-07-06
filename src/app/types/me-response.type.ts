import { UserCompanies } from './user-companies';

export type UserDocument = {
    type: 'CPF' | 'CNPJ';
    value: string;
};

export type SystemRole = 'USER' | 'PLATFORM_ADMIN';

export type MeResponse = {
    id: string;
    name: string;
    email: string;
    document: UserDocument | null;
    companies: UserCompanies[];
    onboardingCompleted: boolean;
    systemRole: SystemRole;
};
