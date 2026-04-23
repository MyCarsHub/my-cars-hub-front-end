export type UserCompanies = {
    companyId: string;
    companyName: string;
    role: 'OWNER' | 'MANAGER' | 'DRIVER';
}