import { FormArray, FormBuilder, FormControl, FormGroup } from '@angular/forms';

import { RentalBillingFrequency, RentalLateFineType } from '../../../types/rental.types';
import { IntervalUnit } from '../charges-flex/charges-flex';

/**
 * O formulário do Novo aluguel em uma página. Os nomes são os do passo a passo
 * (`rental-wizard.ts`), para o corpo sair de `buildCreateBody`; somam-se o desconto da caução
 * (só da tela) e as partes de cada período (`PeriodPartGroup`).
 */
export function createRentalForm(fb: FormBuilder) {
  return fb.nonNullable.group({
    driverId: '',
    vehicleId: '',
    startDate: '',
    pickupTime: '09:00',
    pickupOtherDay: false,
    pickupDay: '',
    endDate: '',
    /** "Fica pelo menos até uma data": o `endDate` é o fim do tempo mínimo (corpo: `minimumTerm`). */
    minimumTerm: false,
    billingFrequency: 'WEEKLY' as RentalBillingFrequency,
    periodRateReais: '',
    firstPaymentDate: '',
    automaticCharge: false,
    caucaoReais: '',
    caucaoPaid: false,
    /** Card 3: "Dar desconto" na caução (o corpo leva o valor já com o desconto). */
    caucaoDescOn: false,
    caucaoDiscount: '',
    caucaoSplit: false,
    descOn: false,
    discountN: '1',
    discountType: 'AMOUNT' as 'AMOUNT' | 'PERCENT',
    discountValue: '',
    parcOn: false,
    splitScope: 'ALL' as 'ALL' | 'SOME',
    splitCount: '',
    splitIntervalN: '',
    splitUnit: 'DAYS' as IntervalUnit,
    splitOffset: '0',
    initialKm: '',
    fuel: '',
    customFuel: '',
    hasKmLimit: false,
    franchiseKm: '',
    extraKmPriceReais: '',
    lateFineType: 'PERCENT' as RentalLateFineType,
    lateFineValue: '',
    lateInterestPercent: '',
    useContractTemplate: false,
    notes: '',
  });
}

export type CreateRentalForm = ReturnType<typeof createRentalForm>;

/** Parte da caução: valor (texto pt-BR) e vencimento. */
export type CaucaoPartGroup = FormGroup<{ amount: FormControl<string>; due: FormControl<string> }>;
/** Parte de cada período: valor (texto pt-BR) e dias depois do vencimento do período. */
export type PeriodPartGroup = FormGroup<{ amount: FormControl<string>; offset: FormControl<number> }>;

export function newCaucaoPart(amount: string, due: string): CaucaoPartGroup {
  return new FormGroup({
    amount: new FormControl(amount, { nonNullable: true }),
    due: new FormControl(due, { nonNullable: true }),
  });
}

export function newPeriodPart(amount: string, offset: number): PeriodPartGroup {
  return new FormGroup({
    amount: new FormControl(amount, { nonNullable: true }),
    offset: new FormControl(offset, { nonNullable: true }),
  });
}

export type CaucaoParts = FormArray<CaucaoPartGroup>;
export type PeriodParts = FormArray<PeriodPartGroup>;

/** "1.200,00" — o texto que os campos mascarados guardam. */
export function centsText(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
