import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import {
  EMPTY,
  Observable,
  catchError,
  concatMap,
  from,
  map,
  merge,
  of,
  switchMap,
  tap,
  toArray,
} from 'rxjs';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { PrimaryInput } from '../../components/primary-input/primary-input';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';
import { NotificationService } from '../../services/notification.service';
import { FinancingFormFields } from '../../components/vehicles/financing-form-fields/financing-form-fields';
import { toCents } from '../../components/vehicles/financing-form-fields/financing-utils';
import { InsuranceFormFields } from '../../components/vehicles/insurance-form-fields/insurance-form-fields';
import { insuranceDateRangeValidator } from '../../components/vehicles/insurance-form-fields/insurance-utils';
import { VehiclesService } from '../../services/vehicles.service';
import { InsurancesService } from '../../services/insurances.service';
import {
  CreateInsuranceRequest,
  InsuranceCoverage,
  InsurancePaymentMethod,
} from '../../types/insurance.types';
import {
  CreateFinancingRequest,
  CreateVehicleRequest,
  Financing,
  IPVA_STATUS_OPTIONS,
  IpvaStatus,
  UpdateVehicleRequest,
  VEHICLE_DOCUMENT_KIND_META,
  VEHICLE_FUEL_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  Vehicle,
  VehicleDocumentKind,
  VehicleFuel,
  VehicleType,
} from '../../types/vehicle.types';
import {
  MAX_DOCUMENT_BYTES,
  VEHICLE_DOCUMENT_ACCEPT,
  formatDocumentSize,
  isAllowedDocumentFile,
} from './vehicle-document-constraints';

const PLATE_PATTERN = /^([A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-Z][0-9]{2})$/;

/**
 * Complemento do banner quando um bloco filho falha sem mensagem do servidor.
 * Fica no fim da frase — o prefixo ("O veículo foi salvo, mas …") é montado em
 * `childErrorMessage`.
 */
const CHILD_RETRY_HINT = 'Tente novamente em instantes.';

/**
 * Arquivo escolhido no cadastro, ainda não (necessariamente) enviado.
 *
 * `status` é a memória do retry: se um upload falhar depois de o veículo ser
 * criado, o reenvio percorre esta lista e PULA o que já está `uploaded` —
 * reenviar duplicaria o documento, porque o backend ACRESCENTA (nenhum kind é
 * único, ver `VehicleDocumentKind`).
 */
interface PendingVehicleDocument {
  /** Id local, só para `track` e para marcar status — nunca vai ao servidor. */
  id: number;
  kind: VehicleDocumentKind;
  file: File;
  status: 'pending' | 'uploaded' | 'error';
}

function yearRangeValidator(group: AbstractControl): ValidationErrors | null {
  const manufacture = group.get('yearManufacture')?.value;
  const model = group.get('yearModel')?.value;
  if (manufacture == null || model == null) return null;
  if (model < manufacture) return { yearModelRange: true };
  if (model > manufacture + 1) return { yearModelRange: true };
  return null;
}

@Component({
  selector: 'app-vehicle-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    PrimaryInput,
    FinancingFormFields,
    InsuranceFormFields,
    AlertBanner,
    FormField,
    FieldControl,
    RouterLink,
  ],
  templateUrl: './vehicle-form.html',
})
export class VehicleForm implements OnInit {
  private readonly vehiclesService = inject(VehiclesService);
  private readonly insurancesService = inject(InsurancesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly typeOptions = VEHICLE_TYPE_OPTIONS;
  protected readonly ipvaStatusOptions = IPVA_STATUS_OPTIONS;
  protected readonly fuelOptions = VEHICLE_FUEL_OPTIONS;

  protected readonly editingId = signal<string | null>(null);
  protected readonly isEdit = computed(() => this.editingId() !== null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly plateMessages: Readonly<Record<string, string>> = {
    required: 'Informe a placa.',
    pattern: 'Placa inválida. Use ABC1234 ou ABC1D23.',
  };
  protected readonly chassisMessages: Readonly<Record<string, string>> = {
    pattern: 'Chassi deve ter 17 caracteres (sem I, O, Q).',
  };
  protected readonly renavamMessages: Readonly<Record<string, string>> = {
    pattern: 'RENAVAM deve ter entre 9 e 11 dígitos.',
  };

  protected readonly plateDisplay = signal('');
  protected readonly showFinancing = signal(false);
  /**
   * Bloco de seguro (opcional). O backend admite apenas UMA apólice ACTIVE por
   * veículo e responde 409 no POST quando já existe — o erro cai no banner
   * inline (`handleInsuranceError`), nunca em toast.
   */
  protected readonly showInsurance = signal(false);

  /**
   * Financiamento ATIVO já vinculado ao veículo (vem em `GET /vehicles/{id}`).
   * O backend só admite um ativo por veículo — `createFinancing` responde 409
   * quando já existe — e não expõe endpoint de atualização (apenas quitar e
   * excluir). Por isso a edição do veículo só oferece ADICIONAR quando este
   * signal está `null`; havendo um ativo, mostramos o resumo somente-leitura
   * com link para a tela do financiamento.
   */
  protected readonly existingFinancing = signal<Financing | null>(null);
  protected readonly canAddFinancing = computed(
    () => !this.isEdit() || this.existingFinancing() === null,
  );

  /**
   * O bloco de documentos só existe no fluxo de CADASTRO — na edição, quem
   * cuida dos anexos é o card do detalhe. O portão é um signal próprio, e NÃO
   * `isEdit()`: quando um filho falha, `editingId` é promovido e `isEdit()`
   * vira true com o form ainda montado — o bloco precisa continuar visível
   * para o retry subir só o que faltou.
   */
  protected readonly documentsEnabled = signal(true);
  protected readonly pendingDocuments = signal<PendingVehicleDocument[]>([]);
  /** Erro de SELEÇÃO (formato/tamanho) — local ao bloco, não ao banner do form. */
  protected readonly documentsPickError = signal<string | null>(null);
  protected readonly documentKindMeta = VEHICLE_DOCUMENT_KIND_META;
  protected readonly documentAccept = VEHICLE_DOCUMENT_ACCEPT;
  /** Mesma semântica do `pendingKind` do card: a intenção do toque, não envio em voo. */
  private pendingDocumentKind: VehicleDocumentKind | null = null;
  private nextPendingDocumentId = 1;
  private readonly docPicker = viewChild<ElementRef<HTMLInputElement>>('docPicker');

  protected readonly form = this.fb.nonNullable.group(
    {
      plate: ['', [Validators.required, Validators.pattern(PLATE_PATTERN)]],
      type: ['CAR' as VehicleType, [Validators.required]],
      brand: ['', [Validators.required, Validators.maxLength(60)]],
      model: ['', [Validators.required, Validators.maxLength(80)]],
      yearManufacture: [
        new Date().getFullYear(),
        [Validators.required, Validators.min(1900), Validators.max(2100)],
      ],
      yearModel: [
        new Date().getFullYear(),
        [Validators.required, Validators.min(1900), Validators.max(2100)],
      ],
      chassis: ['', [Validators.pattern(/^[A-HJ-NPR-Z0-9]{17}$/)]],
      hodometer: [0, [Validators.required, Validators.min(0)]],
      licensingExpiration: [''],
      renavam: ['', [Validators.pattern(/^\d{9,11}$/)]],
      color: [''],
      purchaseDate: [''],
      ipvaAmount: [null as number | null, [Validators.min(0)]],
      ipvaDueDate: [''],
      ipvaStatus: ['' as IpvaStatus | ''],
      fuel: ['' as VehicleFuel | ''],
    },
    { validators: [yearRangeValidator] },
  );

  protected readonly financingForm = this.fb.nonNullable.group({
    contractDate: ['', [Validators.required]],
    purchasePrice: [0, [Validators.required, Validators.min(0.01)]],
    downPayment: [0, [Validators.min(0)]],
    installments: [0, [Validators.min(0)]],
    installmentAmount: [0, [Validators.min(0)]],
  });

  protected readonly insuranceForm = this.fb.nonNullable.group(
    {
      insurer: ['', [Validators.required, Validators.maxLength(120)]],
      policyNumber: ['', [Validators.required, Validators.maxLength(60)]],
      coverageType: ['' as InsuranceCoverage | '', [Validators.required]],
      premiumAmount: [0, [Validators.required, Validators.min(0.01)]],
      deductibleAmount: [null as number | null, [Validators.min(0)]],
      startDate: ['', [Validators.required]],
      endDate: ['', [Validators.required]],
      paymentMethod: ['' as InsurancePaymentMethod | ''],
      notes: [''],
    },
    { validators: [insuranceDateRangeValidator] },
  );

  /**
   * Formulário que originou o banner de validação do submit. Enquanto apontar
   * para um grupo, o banner some sozinho assim que esse grupo voltar a ser
   * válido — banners de erro do servidor não passam por aqui (ficam até a
   * próxima ação, como antes).
   */
  private bannerSource: AbstractControl | null = null;

  constructor() {
    merge(
      this.form.statusChanges,
      this.financingForm.statusChanges,
      this.insuranceForm.statusChanges,
    )
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.bannerSource?.valid) {
          this.bannerSource = null;
          this.error.set(null);
        }
      });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editingId.set(id);
      this.documentsEnabled.set(false);
      this.loadVehicle(id);
      this.form.controls.chassis.disable();
      this.form.controls.renavam.disable();
    }
  }

  protected onPlateInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 7);
    this.form.controls.plate.setValue(raw);
    this.form.controls.plate.markAsTouched();
    this.plateDisplay.set(raw);
  }

  protected onChassisInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 17);
    this.form.controls.chassis.setValue(raw);
    this.form.controls.chassis.markAsTouched();
  }

  protected onRenavamInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 11);
    this.form.controls.renavam.setValue(raw);
    this.form.controls.renavam.markAsTouched();
  }

  private loadVehicle(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.vehiclesService.getOne(id).subscribe({
      next: (v) => {
        this.plateDisplay.set(v.plate ?? '');
        this.existingFinancing.set(v.activeFinancing ?? null);
        this.form.patchValue({
          plate: v.plate,
          type: v.type,
          brand: v.brand,
          model: v.model,
          yearManufacture: v.yearManufacture,
          yearModel: v.yearModel,
          chassis: v.chassis ?? '',
          hodometer: v.hodometer,
          licensingExpiration: v.licensingExpiration ?? '',
          renavam: v.renavam ?? '',
          color: v.color ?? '',
          purchaseDate: v.purchaseDate ?? '',
          ipvaAmount: v.ipvaAmount != null ? v.ipvaAmount / 100 : null,
          ipvaDueDate: v.ipvaDueDate ?? '',
          ipvaStatus: (v.ipvaStatus ?? '') as IpvaStatus | '',
          fuel: (v.fuel ?? '') as VehicleFuel | '',
        });
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Veículo não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  protected toggleFinancing(): void {
    this.showFinancing.update((v) => !v);
  }

  protected toggleInsurance(): void {
    this.showInsurance.update((v) => !v);
  }

  /** O botão do tipo É a afordância: registra o kind e abre o seletor nativo. */
  protected openDocumentPicker(kind: VehicleDocumentKind): void {
    if (this.saving()) return;
    this.documentsPickError.set(null);
    this.pendingDocumentKind = kind;
    this.docPicker()?.nativeElement.click();
  }

  /**
   * Seleção com `multiple`: valida cada arquivo (allowlist + 20MB, as mesmas
   * guardas do card do detalhe), acrescenta os válidos e nomeia os recusados —
   * recusar em silêncio faria o usuário achar que anexou o que não anexou.
   *
   * Dedup por nome+tamanho contra a lista pendente (e dentro da própria
   * seleção): o mesmo arquivo escolhido duas vezes subiria DUAS vezes, porque
   * o backend acrescenta em vez de substituir.
   */
  protected onDocumentsSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const files = Array.from(target.files ?? []);
    // Zera o input ANTES de qualquer retorno: sem isso, escolher o MESMO
    // arquivo de novo depois de removê-lo da lista não dispara `change`.
    target.value = '';
    const kind = this.pendingDocumentKind;
    this.pendingDocumentKind = null;
    if (!kind || files.length === 0) return;

    const seen = new Set(this.pendingDocuments().map((d) => `${d.file.name}|${d.file.size}`));
    const rejected: string[] = [];
    const duplicated: string[] = [];
    const accepted: PendingVehicleDocument[] = [];
    for (const file of files) {
      if (!isAllowedDocumentFile(file) || file.size > MAX_DOCUMENT_BYTES) {
        rejected.push(file.name);
        continue;
      }
      const key = `${file.name}|${file.size}`;
      if (seen.has(key)) {
        duplicated.push(file.name);
        continue;
      }
      seen.add(key);
      accepted.push({ id: this.nextPendingDocumentId++, kind, file, status: 'pending' });
    }
    if (accepted.length > 0) {
      this.pendingDocuments.update((list) => [...list, ...accepted]);
    }
    const problems: string[] = [];
    if (rejected.length > 0) {
      problems.push(
        `Não anexado: ${rejected.join(', ')}. Aceitos PDF, JPG, PNG, WebP e HEIC/HEIF, até 20MB.`,
      );
    }
    if (duplicated.length > 0) {
      problems.push(`Já na lista: ${duplicated.join(', ')}.`);
    }
    this.documentsPickError.set(problems.length > 0 ? problems.join(' ') : null);
  }

  protected removePendingDocument(doc: PendingVehicleDocument): void {
    // `uploaded` já está no servidor — remover daqui não o removeria de lá.
    if (doc.status === 'uploaded' || this.saving()) return;
    this.pendingDocuments.update((list) => list.filter((d) => d.id !== doc.id));
  }

  protected pendingSizeText(doc: PendingVehicleDocument): string {
    return formatDocumentSize(doc.file.size);
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.bannerSource = this.form;
      this.error.set('Verifique os campos destacados e tente novamente.');
      this.focusFirstInvalid();
      return;
    }
    // Vale tanto na criação quanto na edição: se o usuário abriu o bloco, ele é validado.
    if (this.willSubmitFinancing() && this.financingForm.invalid) {
      this.financingForm.markAllAsTouched();
      this.bannerSource = this.financingForm;
      this.error.set('Verifique os campos do financiamento.');
      this.focusFirstInvalid();
      return;
    }
    if (this.willSubmitInsurance() && this.insuranceForm.invalid) {
      this.insuranceForm.markAllAsTouched();
      this.bannerSource = this.insuranceForm;
      this.error.set('Verifique os campos do seguro.');
      this.focusFirstInvalid();
      return;
    }

    this.bannerSource = null;
    this.saving.set(true);
    this.error.set(null);
    clearServerErrors(this.form);
    clearServerErrors(this.financingForm);
    clearServerErrors(this.insuranceForm);

    const raw = this.form.getRawValue();
    const ipvaAmountCents =
      raw.ipvaAmount != null && !Number.isNaN(Number(raw.ipvaAmount))
        ? toCents(Number(raw.ipvaAmount))
        : null;
    const commonPayload = {
      plate: raw.plate.trim().toUpperCase(),
      type: raw.type,
      brand: raw.brand.trim(),
      model: raw.model.trim(),
      yearManufacture: Number(raw.yearManufacture),
      yearModel: Number(raw.yearModel),
      hodometer: Number(raw.hodometer),
      licensingExpiration: raw.licensingExpiration || null,
      color: raw.color?.trim() || null,
      purchaseDate: raw.purchaseDate || null,
      ipvaAmount: ipvaAmountCents,
      ipvaDueDate: raw.ipvaDueDate || null,
      ipvaStatus: (raw.ipvaStatus || null) as IpvaStatus | null,
      fuel: (raw.fuel || null) as VehicleFuel | null,
    };

    if (this.isEdit()) {
      const payload: UpdateVehicleRequest = commonPayload;
      const vehicleId = this.editingId()!; // isEdit() === true garante o id.
      this.saveChildren(this.vehiclesService.update(vehicleId, payload));
    } else {
      const createPayload: CreateVehicleRequest = {
        ...commonPayload,
        chassis: raw.chassis?.trim() || null,
        renavam: raw.renavam?.trim() || null,
      };
      this.saveChildren(this.vehiclesService.create(createPayload));
    }
  }

  /**
   * Move o foco para o primeiro controle inválido em ordem de documento.
   * Controles ligados por `formControlName` carregam a classe `ng-invalid` no
   * próprio elemento (ou no host `app-primary-input`); placa/chassi/RENAVAM são
   * ligados manualmente (`[value]`/`(input)`) e são resolvidos pelo id + estado
   * do control.
   */
  private focusFirstInvalid(): void {
    const manualControls: ReadonlyArray<[string, AbstractControl]> = [
      ['veiculo-plate', this.form.controls.plate],
      ['veiculo-chassis', this.form.controls.chassis],
      ['veiculo-renavam', this.form.controls.renavam],
    ];
    const fields = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('input, select, textarea'),
    );
    const target = fields.find((el) => {
      if (el.classList.contains('ng-invalid')) return true;
      if (el.closest('app-primary-input')?.classList.contains('ng-invalid')) return true;
      const manual = manualControls.find(([id]) => id === el.id);
      return manual !== undefined && manual[1].invalid;
    });
    target?.focus();
  }

  /**
   * Encadeia os blocos opcionais (financiamento e seguro) depois do save do
   * veículo. Cada filho trata o próprio erro inline e completa com `EMPTY`, de
   * modo que uma falha do filho NÃO navega nem dispara o handler do veículo —
   * o PUT/POST do veículo já pode ter passado e o usuário precisa saber disso.
   *
   * `editingId` é promovido assim que o veículo é salvo: na CRIAÇÃO, se um bloco
   * filho falhar o form continua montado, e sem isso o próximo submit dispararia
   * outro POST /vehicles, cadastrando o veículo DUPLICADO. Com o id setado o
   * reenvio vira PUT do mesmo veículo + retry só do filho que falhou.
   */
  private saveChildren(save$: Observable<Vehicle>): void {
    save$
      .pipe(
        tap((v) => this.editingId.set(v.id)),
        switchMap((v) => this.financingStep(v)),
        switchMap((v) => this.insuranceStep(v)),
        switchMap((v) => this.documentsStep(v)),
      )
      .subscribe({
        next: (v) => {
          this.saving.set(false);
          if (this.willSubmitFinancing()) {
            this.notifications.success('Financiamento adicionado ao veículo.');
          }
          if (this.willSubmitInsurance()) {
            this.notifications.success('Seguro adicionado ao veículo.');
          }
          // `willSubmitDocuments()` não serve aqui: chegando neste ponto todos
          // os arquivos já estão `uploaded` e ela responde false.
          const sent = this.pendingDocuments().length;
          if (this.documentsEnabled() && sent > 0) {
            this.notifications.success(
              sent === 1 ? 'Documento anexado ao veículo.' : `${sent} documentos anexados ao veículo.`,
            );
          }
          this.router.navigate(['/veiculos', v.id]);
        },
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
  }

  private financingStep(v: Vehicle): Observable<Vehicle> {
    if (!this.willSubmitFinancing()) return of(v);
    return this.vehiclesService.createFinancing(v.id, this.buildFinancingPayload()).pipe(
      map(() => v),
      catchError((err: HttpErrorResponse) => {
        this.handleFinancingError(err);
        return EMPTY;
      }),
    );
  }

  private insuranceStep(v: Vehicle): Observable<Vehicle> {
    if (!this.willSubmitInsurance()) return of(v);
    return this.insurancesService.create(v.id, this.buildInsurancePayload()).pipe(
      map(() => v),
      catchError((err: HttpErrorResponse) => {
        this.handleInsuranceError(err);
        return EMPTY;
      }),
    );
  }

  /**
   * TERCEIRO elo do `saveChildren`, depois de financiamento e seguro. O
   * endpoint aceita UM arquivo por chamada, e o envio é SEQUENCIAL de
   * propósito: N multiparts em paralelo num celular em 4G disputam a mesma
   * banda e tendem a falhar todos juntos.
   *
   * Diferente dos outros filhos, uma falha NÃO aborta o elo: os arquivos
   * restantes ainda são tentados e cada um marca o próprio `status`. Só no
   * fim a falha vira banner + `EMPTY` (sem navegação, form montado). O retry
   * então envia SÓ o que não está `uploaded` — ver `PendingVehicleDocument`.
   */
  private documentsStep(v: Vehicle): Observable<Vehicle> {
    if (!this.willSubmitDocuments()) return of(v);
    const toSend = this.pendingDocuments().filter((d) => d.status !== 'uploaded');
    let firstError: HttpErrorResponse | null = null;
    let failed = 0;
    return from(toSend).pipe(
      concatMap((doc) =>
        this.vehiclesService.uploadDocument(v.id, doc.kind, doc.file).pipe(
          tap(() => this.markPendingDocument(doc.id, 'uploaded')),
          catchError((err: HttpErrorResponse) => {
            this.markPendingDocument(doc.id, 'error');
            firstError ??= err;
            failed += 1;
            return of(null);
          }),
        ),
      ),
      toArray(),
      switchMap(() => {
        if (firstError !== null) {
          this.handleDocumentsError(firstError, failed);
          return EMPTY;
        }
        return of(v);
      }),
    );
  }

  private markPendingDocument(id: number, status: PendingVehicleDocument['status']): void {
    this.pendingDocuments.update((list) =>
      list.map((d) => (d.id === id ? { ...d, status } : d)),
    );
  }

  /**
   * O bloco de financiamento só é enviado quando o usuário o abriu E o veículo
   * ainda não tem um financiamento ativo (na criação `canAddFinancing()` é sempre true).
   */
  protected willSubmitFinancing(): boolean {
    return this.showFinancing() && this.canAddFinancing();
  }

  /** O bloco de seguro só é enviado quando o usuário o abriu. */
  protected willSubmitInsurance(): boolean {
    return this.showInsurance();
  }

  /** Só há elo de documentos quando o bloco existe (cadastro) e resta arquivo não enviado. */
  protected willSubmitDocuments(): boolean {
    return this.documentsEnabled() && this.pendingDocuments().some((d) => d.status !== 'uploaded');
  }

  private buildInsurancePayload(): CreateInsuranceRequest {
    const raw = this.insuranceForm.getRawValue();
    return {
      insurer: raw.insurer.trim(),
      policyNumber: raw.policyNumber.trim(),
      coverageType: raw.coverageType as InsuranceCoverage,
      premiumAmount: toCents(Number(raw.premiumAmount)) ?? 0,
      deductibleAmount: raw.deductibleAmount != null ? toCents(Number(raw.deductibleAmount)) : null,
      startDate: raw.startDate,
      endDate: raw.endDate,
      // `''` (opção "Não informada") vira null — o enum do backend não aceita
      // string vazia, e texto livre passou a responder 400.
      paymentMethod: raw.paymentMethod || null,
      notes: raw.notes?.trim() || null,
    };
  }

  private buildFinancingPayload(): CreateFinancingRequest {
    const fRaw = this.financingForm.getRawValue();
    return {
      contractDate: fRaw.contractDate,
      purchasePrice: toCents(Number(fRaw.purchasePrice)) ?? 0,
      downPayment: fRaw.downPayment ? toCents(Number(fRaw.downPayment)) : null,
      installments: fRaw.installments ? Number(fRaw.installments) : null,
      installmentAmount: fRaw.installmentAmount ? toCents(Number(fRaw.installmentAmount)) : null,
      totalFinanced: null,
    };
  }

  /**
   * Backend `fieldErrors` land on the matching controls (inline, under the field);
   * only what is left over goes to the form banner. Never a toast — the interceptor
   * skips 4xx and `ApiErrorService.handleForm` claims the error so the safety net
   * stays quiet.
   */
  private handleError(err: HttpErrorResponse): void {
    this.saving.set(false);
    const { formMessage } = this.apiErrors.handleForm(
      err,
      this.form,
      'Não foi possível salvar o veículo.',
    );
    this.error.set(formMessage);
  }

  /**
   * Falha do POST do financiamento. `fieldErrors` de `contractDate` /
   * `purchasePrice` / … caem inline no `financingForm`; o que sobrar (ex.: 409
   * "já existe financiamento ativo") entra no banner.
   */
  private handleFinancingError(err: HttpErrorResponse): void {
    this.saving.set(false);
    const { formMessage, applied } = this.apiErrors.handleForm(
      err,
      this.financingForm,
      CHILD_RETRY_HINT,
    );
    this.error.set(this.childErrorMessage('financiamento', formMessage, applied.length > 0));
  }

  /**
   * Falha do POST do seguro. `fieldErrors` caem inline no `insuranceForm`; o que
   * sobrar (ex.: 409 "veículo já possui apólice ativa") vai para o banner —
   * nunca para um toast.
   */
  private handleInsuranceError(err: HttpErrorResponse): void {
    this.saving.set(false);
    const { formMessage, applied } = this.apiErrors.handleForm(
      err,
      this.insuranceForm,
      CHILD_RETRY_HINT,
    );
    this.error.set(this.childErrorMessage('seguro', formMessage, applied.length > 0));
  }

  /**
   * Falha de upload no elo de documentos. Não há form reativo por trás dos
   * arquivos, então nada é inline de campo: tudo vira banner, sempre com o
   * prefixo "o veículo foi salvo" (mesma razão de `childErrorMessage`).
   * `messageFor` já faz o `claim` — o safety net do interceptor fica quieto.
   */
  private handleDocumentsError(err: HttpErrorResponse, failedCount: number): void {
    this.saving.set(false);
    const head =
      failedCount === 1
        ? 'O veículo foi salvo, mas 1 documento não foi enviado.'
        : `O veículo foi salvo, mas ${failedCount} documentos não foram enviados.`;
    const detail = this.apiErrors.messageFor(err, CHILD_RETRY_HINT);
    this.error.set(`${head} ${detail} Salvar de novo reenvia apenas o que faltou.`);
  }

  /**
   * Mensagem de falha de um bloco filho. O prefixo é obrigatório: quando o
   * filho falha o veículo JÁ foi salvo (POST/PUT 2xx), e omitir isso é o que
   * levava o usuário a reenviar o formulário achando que nada tinha gravado.
   * O detalhe do servidor é preservado ao final para não perder o motivo real.
   */
  private childErrorMessage(
    kind: 'financiamento' | 'seguro',
    formMessage: string | null,
    hasFieldErrors: boolean,
  ): string {
    const head = `O veículo foi salvo, mas o ${kind} não foi adicionado.`;
    if (formMessage) return `${head} ${formMessage}`;
    if (hasFieldErrors) return `${head} Verifique os campos destacados e tente novamente.`;
    return `${head} ${CHILD_RETRY_HINT}`;
  }

  protected cancel(): void {
    if (this.isEdit()) {
      this.router.navigate(['/veiculos', this.editingId()]);
    } else {
      this.router.navigate(['/veiculos']);
    }
  }

  protected fieldInvalid(path: string[]): boolean {
    let ctrl: AbstractControl | null = this.form;
    for (const seg of path) ctrl = ctrl?.get(seg) ?? null;
    return !!ctrl && ctrl.invalid && ctrl.touched;
  }

  protected financingFieldInvalid(name: string): boolean {
    const ctrl = this.financingForm.get(name);
    return !!ctrl && ctrl.invalid && ctrl.touched;
  }

  protected formatCurrency(cents: number | null | undefined): string {
    if (cents == null) return '—';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      cents / 100,
    );
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('pt-BR');
  }

  protected hasYearRangeError(): boolean {
    return (
      this.form.hasError('yearModelRange') &&
      (this.form.controls.yearModel.touched || this.form.controls.yearManufacture.touched)
    );
  }
}
