import { UserCompanies } from './user-companies';

export type MeResponse = {
    id: string;
    name: string;
    email: string;
    companies: UserCompanies[];
    onboardingCompleted: boolean;
};