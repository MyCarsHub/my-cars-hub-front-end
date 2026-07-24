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
    /**
     * Explicit onboarding-completion flag from the backend (BE PR #30).
     * Nullable to distinguish:
     *  - `true` / `false` — /auth/me served the field, use it verbatim.
     *  - `null` / `undefined` — either the login-step response (no decision
     *    yet) or a pre-#30 backend during a deploy skew; fall back to the
     *    legacy `companies.length > 0` derivation.
     * Replaces the previous derivation-only approach (BUG-15).
     */
    hasCompletedOnboarding?: boolean | null;
    systemRole: SystemRole;
};
