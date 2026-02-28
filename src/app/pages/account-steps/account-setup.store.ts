import { computed, Injectable, signal } from '@angular/core';

export interface AccountFormData {
    fullName: string;
    cpf: string;
    phone: string;
    companyName: string;
    hasCnpj: boolean;
    cnpj: string;
}

export interface StepConfig {
    step: number;
    title: string;
    subtitle: string;
    icon: string;
}

const STEPS: StepConfig[] = [
    {
        step: 1,
        title: 'Dados Pessoais',
        subtitle: 'Precisamos de algumas informações para configurar sua conta.',
        icon: '👤',
    },
    {
        step: 2,
        title: 'Empresa',
        subtitle: 'Informe o nome da organização que será criada.',
        icon: '🏢',
    },
    {
        step: 3,
        title: 'CNPJ',
        subtitle: 'Caso sua empresa possua CNPJ, informe abaixo. Não é obrigatório.',
        icon: '📋',
    },
    {
        step: 4,
        title: 'Pronto!',
        subtitle: '',
        icon: '🚀',
    },
];

const INITIAL_FORM_DATA: AccountFormData = {
    fullName: '',
    cpf: '',
    phone: '',
    companyName: '',
    hasCnpj: false,
    cnpj: '',
};

@Injectable({ providedIn: 'root' })
export class AccountSetupStore {
    readonly currentStep = signal(1);
    readonly totalSteps = STEPS.length;
    readonly steps = STEPS;
    readonly formData = signal<AccountFormData>({ ...INITIAL_FORM_DATA });

    /** Direction of navigation for animations: 1 = forward, -1 = backward */
    readonly direction = signal<1 | -1>(1);

    readonly currentStepConfig = computed(
        () => STEPS.find((s) => s.step === this.currentStep()) ?? STEPS[0]
    );

    readonly isFirstStep = computed(() => this.currentStep() === 1);
    readonly isLastStep = computed(() => this.currentStep() === this.totalSteps);
    readonly progressPercent = computed(() => (this.currentStep() / this.totalSteps) * 100);

    next(): void {
        if (this.currentStep() < this.totalSteps) {
            this.direction.set(1);
            this.currentStep.update((s) => s + 1);
        }
    }

    back(): void {
        if (this.currentStep() > 1) {
            this.direction.set(-1);
            this.currentStep.update((s) => s - 1);
        }
    }

    goToStep(step: number): void {
        if (step >= 1 && step <= this.totalSteps) {
            this.direction.set(step > this.currentStep() ? 1 : -1);
            this.currentStep.set(step);
        }
    }

    updateField<K extends keyof AccountFormData>(field: K, value: AccountFormData[K]): void {
        this.formData.update((data) => ({ ...data, [field]: value }));
    }

    updateFields(partial: Partial<AccountFormData>): void {
        this.formData.update((data) => ({ ...data, ...partial }));
    }

    reset(): void {
        this.currentStep.set(1);
        this.direction.set(1);
        this.formData.set({ ...INITIAL_FORM_DATA });
    }

    canAdvance(): boolean {
        const data = this.formData();
        const step = this.currentStep();

        switch (step) {
            case 1:
                return data.fullName.trim().length > 0 && data.cpf.trim().length > 0 && data.phone.trim().length > 0;
            case 2:
                return data.companyName.trim().length > 0;
            case 3:
                return true; // CNPJ is optional
            default:
                return true;
        }
    }
}
