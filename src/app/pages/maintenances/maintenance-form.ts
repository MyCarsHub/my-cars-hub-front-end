import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, Observable, catchError, concatMap, from, map, of, switchMap, tap, toArray } from 'rxjs';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { PageCard } from '../../components/core/page-card/page-card';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { ApiErrorService } from '../../services/api-error.service';
import { clearServerErrors } from '../../services/api-error';
import { NotificationService } from '../../services/notification.service';
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import {
  CreateMaintenanceRequest,
  MAINTENANCE_DOCUMENT_KIND_META,
  MAINTENANCE_STATUS_OPTIONS,
  MAINTENANCE_TYPE_OPTIONS,
  Maintenance,
  MaintenanceDocumentKind,
  MaintenanceItemRequest,
  MaintenanceStatus,
  MaintenanceType,
  UpdateMaintenanceRequest,
} from '../../types/maintenance.types';
import {
  MAINTENANCE_DOC_ACCEPT,
  MAINTENANCE_DOC_MAX_BYTES,
  PendingMaintenanceDoc,
  formatDocSize,
  isAllowedMaintenanceDoc,
} from './maintenance-document-upload';
import { formatBRL } from '../../types/dashboard.types';
import { VehicleListItem } from '../../types/vehicle.types';
import {
  ITEMS_MAX,
  QUANTITY_MAX,
  UNIT_PRICE_MAX_CENTS,
  computeCostBreakdown,
  formatQuantity,
  parseQuantityMilli,
  quantityMilliToNumber,
} from './maintenance-cost';
import {
  MONEY_DECIMALS,
  formatPtBrMoney,
  formatPtBrNumber,
  parsePtBrMoneyCents,
  parsePtBrNumber,
} from '../../utils/ptbr-number';

/** Uma linha de peça do `FormArray`. */
type ItemGroup = FormGroup<{
  name: FormControl<string>;
  quantity: FormControl<string>;
  unitPriceReais: FormControl<string>;
}>;

/**
 * Casas decimais do hodômetro: NENHUMA. Km é inteiro no formulário, no payload e na
 * coluna do backend — `150,5 km` não existe, e por isso é recusado em vez de aceito e
 * arredondado.
 */
const HODOMETER_DECIMALS = 0;

/**
 * Todo campo numérico desta tela é `type="text"` + `inputmode`, nunca `type="number"`.
 *
 * `<input type="number">` foi o veículo do defeito que este arquivo conserta. Ele
 * recusa a vírgula no teclado pt-BR (visível, chato) e — pior — passa o resto por
 * `parseFloat`, de modo que `1.500` chegava ao formulário como `1.5`: R$ 1,50 gravado
 * no lugar de R$ 1.500,00, sem recusa e sem mensagem. Um campo que reinterpreta em
 * silêncio o que a pessoa digitou não pode segurar dinheiro.
 *
 * Com texto, o controle guarda exatamente o que foi digitado e estes validadores são
 * os únicos que decidem o que aquilo significa — na gramática de `utils/ptbr-number`,
 * a mesma que a tela imprime. `inputmode` mantém o teclado numérico no celular, que é
 * onde este formulário mais é usado: `decimal` onde há vírgula, `numeric` no hodômetro,
 * que só tem dígitos.
 *
 * O hodômetro entrou nesta regra depois dos cinco campos de custo, e pelo mesmo motivo:
 * a tela de detalhe imprime `150.000 km`, e redigitar essa string num `type="number"`
 * entregava `hodometerReading: 150` — mil vezes menos, sem recusa e sem mensagem.
 */
function quantityValidator(control: AbstractControl): ValidationErrors | null {
  const raw = control.value as string;
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { required: true };
  }

  // Formato inválido e casa decimal a mais compartilham a chave `quantityFormat` de
  // propósito: uma mensagem só cobre as duas causas ("vírgula para decimais, até 3
  // casas, ponto só para milhar") e o contrato de erro do campo continua o mesmo.
  const milli = parseQuantityMilli(raw);
  if (milli === null) return { quantityFormat: true };
  if (milli <= 0) return { quantityMin: true };
  if (milli > QUANTITY_MAX * 1000) return { quantityMax: { max: QUANTITY_MAX } };
  return null;
}

/**
 * Validador de dinheiro — a MESMA gramática da quantidade, só que com precisão 2.
 *
 * Nada é arredondado: `1500,555` num campo de centavos é recusado com mensagem, não
 * convertido para `1500,56`. O `type="number"` antigo arredondava (via `Math.round`
 * dentro de `toCents`) e essa era mais uma coerção silenciosa.
 */
function moneyValidator(maxCents?: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = control.value as string;
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return { required: true };
    }

    const { scaled, error } = parsePtBrMoneyCents(raw);
    if (error === 'decimals') return { moneyDecimals: { max: MONEY_DECIMALS } };
    if (error !== null || scaled === null) return { moneyFormat: true };
    if (maxCents !== undefined && scaled > maxCents) return { max: { max: maxCents / 100 } };
    return null;
  };
}

/**
 * Validador do hodômetro — a MESMA gramática do dinheiro e da quantidade, na precisão
 * INTEIRA. `150.000` é cento e cinquenta mil km, que é exatamente o que a tela de
 * detalhe imprime.
 *
 * `Validators.min(0)` saiu junto com o `type="number"`: a gramática não tem sinal, então
 * `-1` já é recusado como formato e o `min` não tinha mais o que fazer. Vazio continua
 * válido quando o campo é opcional — hodômetro em branco significa "ainda não sei", e é
 * um estado legítimo de uma manutenção agendada.
 */
function hodometerValidator(required: boolean): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = control.value as string;
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return required ? { required: true } : null;
    }

    const { scaled, error } = parsePtBrNumber(raw, HODOMETER_DECIMALS);
    // Casa decimal aqui é quase sempre o separador trocado (`150,000`). Recusa com
    // mensagem — nunca lido como 150, nunca como 150000 por adivinhação.
    if (error === 'decimals') return { hodometerDecimals: true };
    if (error !== null || scaled === null) return { hodometerFormat: true };
    return null;
  };
}

@Component({
  selector: 'app-maintenance-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DefaultPageLayout, PageCard, AlertBanner, FormField, FieldControl],
  templateUrl: './maintenance-form.html',
})
export class MaintenanceForm implements OnInit {
  private readonly maintenancesService = inject(MaintenancesService);
  private readonly vehiclesService = inject(VehiclesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly typeOptions = MAINTENANCE_TYPE_OPTIONS.filter((o) => o.value !== '');
  protected readonly statusOptions = MAINTENANCE_STATUS_OPTIONS.filter((o) => o.value !== '');

  protected readonly itemsMax = ITEMS_MAX;

  protected readonly editingId = signal<string | null>(null);
  protected readonly isEdit = computed(() => this.editingId() !== null);

  /**
   * A tela foi ABERTA como edição (a rota trouxe id), diferente de `isEdit()`,
   * que passa a ser verdadeiro assim que a manutenção é criada.
   *
   * A distinção não é estilística e é o que faz o reenvio funcionar: depois de
   * um cadastro cujo anexo falhou, `editingId` já está preenchido; se o bloco de
   * documentos fosse escondido por `isEdit()`, ele sumiria da tela exatamente no
   * momento em que o usuário precisa dele para reenviar o que faltou.
   */
  private readonly startedAsEdit = signal(false);

  /** O bloco de anexos só existe no CADASTRO — na edição quem anexa é o detalhe. */
  protected readonly showDocuments = computed(() => !this.startedAsEdit());

  /** Arquivos escolhidos e ainda NÃO enviados. Some da fila conforme sobem. */
  protected readonly pendingDocs = signal<PendingMaintenanceDoc[]>([]);

  /** Contador local para o `uid` — sem `Math.random`, sem `Date.now`. */
  private pendingSeq = 0;

  /** Tipo alvo do seletor de arquivos, escrito no toque e lido no `change`. */
  private readonly pendingKind = signal<MaintenanceDocumentKind | null>(null);

  protected readonly docAccept = MAINTENANCE_DOC_ACCEPT;

  private readonly docPicker = viewChild<ElementRef<HTMLInputElement>>('docPicker');

  protected readonly docSlots: ReadonlyArray<{ kind: MaintenanceDocumentKind; label: string }> = [
    { kind: 'NOTA_FISCAL', label: MAINTENANCE_DOCUMENT_KIND_META['NOTA_FISCAL'] },
    { kind: 'OTHER', label: MAINTENANCE_DOCUMENT_KIND_META['OTHER'] },
  ];
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly vehicles = signal<VehicleListItem[]>([]);

  protected readonly form = this.fb.nonNullable.group({
    vehicleId: ['', [Validators.required]],
    type: ['PREVENTIVE' as MaintenanceType, [Validators.required]],
    description: ['', [Validators.required, Validators.maxLength(300)]],
    serviceDate: ['', [Validators.required]],
    // Texto, não número — ver `hodometerValidator`. Vazio é o "ainda não sei", e é o
    // único valor inicial que já round-trips na gramática que o campo aceita de volta.
    hodometerReading: ['', [hodometerValidator(false)]],
    /**
     * Peças. Começa VAZIO de propósito: peça é opcional, e uma linha em branco
     * obrigatória diria o contrário ao usuário logo na abertura da tela.
     */
    items: this.fb.array<ItemGroup>([]),
    // Texto, não número — ver `moneyValidator`. `'0,00'` é o zero escrito na mesma
    // gramática que o campo aceita de volta, então o valor inicial já round-trips.
    // `Validators.min(0)` saiu porque não tinha o que fazer aqui: `parseFloat` de
    // '1.500,50' é 1.5, então o `min` antigo aprovava justamente o valor corrompido.
    // Número negativo agora é recusado pela própria gramática.
    labourReais: ['0,00', [moneyValidator()]],
    discountReais: ['0,00', [moneyValidator()]],
    surchargeReais: ['0,00', [moneyValidator()]],
    surchargeNote: ['', [Validators.maxLength(120)]],
    provider: ['', [Validators.maxLength(120)]],
    invoiceNumber: ['', [Validators.maxLength(60)]],
    nextServiceDate: [''],
    nextServiceHodometer: ['', [hodometerValidator(false)]],
    status: ['SCHEDULED' as MaintenanceStatus, [Validators.required]],
    notes: [''],
  });

  protected get items() {
    return this.form.controls.items;
  }

  /**
   * Espelha `form.valueChanges` para que o resumo abaixo recompute sob OnPush.
   * Reactive forms não são signals; este é o mesmo gatilho usado no `rental-form`.
   */
  private readonly formValue = toSignal(this.form.valueChanges);

  /**
   * O total ao vivo. Lê os controles direto — `formValue()` existe só como
   * dependência que dispara o recálculo a cada mudança do formulário.
   */
  protected readonly breakdown = computed(() => {
    this.formValue();
    return this.readBreakdown();
  });

  protected readonly lineTotalLabels = computed(() =>
    this.breakdown().lineTotals.map((cents) => formatBRL(cents)),
  );
  protected readonly itemsTotalLabel = computed(() => formatBRL(this.breakdown().itemsCents));
  protected readonly totalLabel = computed(() => formatBRL(this.breakdown().totalCents));

  /**
   * O backend recusa desconto maior que `peças + mão de obra + acréscimos` — um total
   * negativo não é um custo. Mostrado antes do round-trip.
   */
  protected readonly discountExceedsBase = computed(() => this.breakdown().totalCents < 0);

  protected readonly hasItems = computed(() => this.breakdown().lineTotals.length > 0);

  /** Espelha o status escolhido para o template reagir sem lógica inline. */
  protected readonly currentStatus = signal<MaintenanceStatus>('SCHEDULED');

  /**
   * O backend só exige o hodômetro quando a manutenção já foi realizada
   * (`status = DONE`); agendada/em andamento/cancelada aceitam null.
   */
  protected readonly hodometerRequired = computed(() => this.currentStatus() === 'DONE');

  /**
   * A dica ENSINA a gramática que o campo aceita — o ponto é milhar, como no detalhe.
   * Um campo que mostra `150.000 km` e não diz que aceita `150.000` de volta é o
   * começo do defeito que este arquivo conserta.
   */
  protected readonly hodometerHint = computed(() =>
    this.hodometerRequired()
      ? 'Leitura no momento do serviço, em km inteiros. Ex: 150.000'
      : 'Só é exigido quando o status for “Realizada”. Deixe em branco se ainda não sabe. Ex: 150.000',
  );

  /** Dica do hodômetro previsto — a mesma gramática, o mesmo exemplo. */
  protected readonly nextHodometerHint = 'Km inteiros. Ex: 150.000';

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly vehicleMessages: Readonly<Record<string, string>> = {
    required: 'Selecione um veículo.',
  };
  protected readonly typeMessages: Readonly<Record<string, string>> = {
    required: 'Selecione o tipo de manutenção.',
  };
  protected readonly descriptionMessages: Readonly<Record<string, string>> = {
    required: 'Descreva o serviço.',
  };
  protected readonly serviceDateMessages: Readonly<Record<string, string>> = {
    required: 'Informe a data do serviço.',
  };
  protected readonly statusMessages: Readonly<Record<string, string>> = {
    required: 'Selecione o status da manutenção.',
  };
  protected readonly hodometerMessages: Readonly<Record<string, string>> = {
    required: 'Informe o hodômetro atual para registrar uma manutenção já realizada.',
    hodometerFormat: 'Use km inteiros. O ponto separa milhar. Ex: 150.000',
    hodometerDecimals: 'O hodômetro é em km inteiros, sem casas decimais. Ex: 150.000',
  };
  protected readonly itemNameMessages: Readonly<Record<string, string>> = {
    required: 'Informe o nome da peça.',
    maxlength: 'Máximo de 120 caracteres.',
  };
  /**
   * Toda recusa diz o que fazer, e diz com um exemplo escrito na gramática do próprio
   * campo. Se o texto não vira número, ele vira mensagem — nunca vira outro número.
   */
  protected readonly quantityMessages: Readonly<Record<string, string>> = {
    required: 'Informe a quantidade.',
    quantityFormat:
      'Use vírgula para os decimais, até 3 casas. O ponto separa milhar. Ex: 3,5 ou 1.500',
    quantityMin: 'A quantidade deve ser maior que zero.',
    quantityMax: `Máximo de ${QUANTITY_MAX} por peça.`,
  };
  private readonly moneyFormatMessage =
    'Use vírgula para os centavos e ponto só para o milhar. Ex: 1.500,50';
  private readonly moneyDecimalsMessage =
    'Use no máximo 2 casas decimais, os centavos. Ex: 1.500,50';
  protected readonly unitPriceMessages: Readonly<Record<string, string>> = {
    required: 'Informe o valor unitário. Ex: 1.500,50',
    moneyFormat: this.moneyFormatMessage,
    moneyDecimals: this.moneyDecimalsMessage,
    max: 'Valor unitário acima do limite aceito.',
  };
  protected readonly moneyMessages: Readonly<Record<string, string>> = {
    required: 'Informe um valor. Use 0,00 se não houver. Ex: 1.500,50',
    moneyFormat: this.moneyFormatMessage,
    moneyDecimals: this.moneyDecimalsMessage,
  };
  /** Dica persistente dos campos numéricos — ensina a MESMA gramática que eles aceitam. */
  protected readonly moneyHint = 'Ex: 1.500,50';
  protected readonly quantityHint = 'Ex: 3,5';

  /** Leitura vinda do backend na edição — usada para não apagar valor sem intenção. */
  private readonly loadedHodometer = signal<number | null>(null);

  ngOnInit(): void {
    this.form.controls.status.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => this.onStatusChange(status));
    this.applyHodometerValidators(this.form.controls.status.value);

    this.vehiclesService.list({ size: 500, sort: 'plate_asc' }).subscribe({
      next: (res) => this.vehicles.set(res.content ?? []),
      error: () => this.vehicles.set([]),
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editingId.set(id);
      this.startedAsEdit.set(true);
      this.load(id);
      this.form.controls.vehicleId.disable();
    }
  }

  private newItemGroup(name = '', quantity = '1', unitPriceReais = '0,00'): ItemGroup {
    return this.fb.nonNullable.group({
      name: [name, [Validators.required, Validators.maxLength(120)]],
      quantity: [quantity, [quantityValidator]],
      // Zero é legítimo (peça de cortesia, item incluso no serviço). O teto espelha a
      // regra de serviço do backend e existe como guarda-corpo técnico, não como
      // limite comercial — o usuário só o encontra se tentar ultrapassá-lo. Ele agora
      // é conferido em CENTAVOS, dentro do validador, e não em reais fracionários.
      unitPriceReais: [unitPriceReais, [moneyValidator(UNIT_PRICE_MAX_CENTS)]],
    }) as ItemGroup;
  }

  protected addItem(): void {
    if (this.items.length >= ITEMS_MAX) return;
    this.items.push(this.newItemGroup());
  }

  /**
   * Remover a ÚLTIMA linha é permitido: peça é opcional, então zero peça precisa ser
   * alcançável pelo formulário.
   */
  protected removeItem(index: number): void {
    this.items.removeAt(index);
  }

  /**
   * Centavos do texto digitado. Texto inválido vale `0` AQUI porque o total ao vivo
   * não pode explodir enquanto a pessoa ainda está no meio de uma digitação; a recusa
   * de verdade é do validador, que mostra a mensagem e bloqueia o envio. O total nunca
   * é a única evidência de que algo está errado.
   */
  private centsOf(value: string): number {
    return parsePtBrMoneyCents(value).scaled ?? 0;
  }

  /**
   * Km do texto digitado. `null` para vazio E para inválido — mas o inválido nunca
   * chega ao payload, porque `submit()` só passa com o formulário válido e o validador
   * já barrou a string fora da gramática. Aqui `null` significa "sem leitura".
   */
  private kmOf(value: string): number | null {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    return parsePtBrNumber(value, HODOMETER_DECIMALS).scaled;
  }

  /**
   * Km do backend → texto editável, formatado pelo MESMO módulo que o campo lê de
   * volta: o que a edição carrega é exatamente o que a edição aceita.
   */
  private hodometerText(km: number | null | undefined): string {
    return km === null || km === undefined ? '' : formatPtBrNumber(km, HODOMETER_DECIMALS);
  }

  private readBreakdown() {
    const lines = this.items.controls.map((group) => ({
      quantityMilli: parseQuantityMilli(group.controls.quantity.value) ?? 0,
      unitPriceCents: this.centsOf(group.controls.unitPriceReais.value),
    }));

    return computeCostBreakdown({
      lines,
      labourCents: this.centsOf(this.form.controls.labourReais.value),
      discountCents: this.centsOf(this.form.controls.discountReais.value),
      surchargeCents: this.centsOf(this.form.controls.surchargeReais.value),
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.maintenancesService.getOne(id).subscribe({
      next: (m) => {
        this.items.clear();
        for (const item of m.items ?? []) {
          this.items.push(
            // Formatado pelo mesmo módulo que o campo lê de volta: o que a edição
            // carrega é exatamente o que a edição aceita.
            this.newItemGroup(
              item.name,
              formatQuantity(item.quantity),
              formatPtBrMoney(item.unitPriceCents),
            ),
          );
        }

        this.form.patchValue({
          vehicleId: m.vehicleId,
          type: m.type,
          description: m.description,
          serviceDate: m.serviceDate,
          hodometerReading: this.hodometerText(m.hodometerReading),
          labourReais: formatPtBrMoney(m.labourCostCents),
          discountReais: formatPtBrMoney(m.discountCents),
          surchargeReais: formatPtBrMoney(m.surchargeCents),
          surchargeNote: m.surchargeNote ?? '',
          provider: m.provider ?? '',
          invoiceNumber: m.invoiceNumber ?? '',
          nextServiceDate: m.nextServiceDate ?? '',
          nextServiceHodometer: this.hodometerText(m.nextServiceHodometer),
          status: m.status,
          notes: m.notes ?? '',
        });
        this.loadedHodometer.set(m.hodometerReading ?? null);
        this.onStatusChange(m.status);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Manutenção não encontrada.'));
        this.loading.set(false);
      },
    });
  }

  /** As peças do payload. Lista vazia é válida e APAGA as peças no PUT full-replace. */
  private itemsPayload(): MaintenanceItemRequest[] {
    return this.items.controls.map((group) => ({
      name: group.controls.name.value.trim(),
      quantity: quantityMilliToNumber(parseQuantityMilli(group.controls.quantity.value) ?? 0),
      unitPriceCents: this.centsOf(group.controls.unitPriceReais.value),
    }));
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Verifique os campos destacados e tente novamente.');
      return;
    }
    if (this.discountExceedsBase()) {
      this.form.controls.discountReais.markAsTouched();
      this.error.set('O desconto não pode ser maior que peças + mão de obra + acréscimos.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    clearServerErrors(this.form);
    const raw = this.form.getRawValue();
    const items = this.itemsPayload();
    const labourCostCents = this.centsOf(raw.labourReais);
    const discountCents = this.centsOf(raw.discountReais);
    const surchargeCents = this.centsOf(raw.surchargeReais);
    const surchargeNote = raw.surchargeNote?.trim() || null;

    if (this.isEdit()) {
      const payload: UpdateMaintenanceRequest = {
        type: raw.type,
        description: raw.description.trim(),
        serviceDate: raw.serviceDate,
        hodometerReading: this.hodometerForUpdate(raw.hodometerReading),
        items,
        labourCostCents,
        discountCents,
        surchargeCents,
        surchargeNote,
        provider: raw.provider?.trim() || null,
        invoiceNumber: raw.invoiceNumber?.trim() || null,
        nextServiceDate: raw.nextServiceDate || null,
        nextServiceHodometer: this.kmOf(raw.nextServiceHodometer),
        status: raw.status,
        notes: raw.notes?.trim() || null,
      };
      this.saveChildren(this.maintenancesService.update(this.editingId()!, payload));
    } else {
      const payload: CreateMaintenanceRequest = {
        vehicleId: raw.vehicleId,
        type: raw.type,
        description: raw.description.trim(),
        serviceDate: raw.serviceDate,
        hodometerReading: this.kmOf(raw.hodometerReading),
        items,
        labourCostCents,
        discountCents,
        surchargeCents,
        surchargeNote,
        provider: raw.provider?.trim() || null,
        invoiceNumber: raw.invoiceNumber?.trim() || null,
        nextServiceDate: raw.nextServiceDate || null,
        nextServiceHodometer: this.kmOf(raw.nextServiceHodometer),
        // Sempre explícito: omitir faria o backend assumir DONE e exigir hodômetro.
        status: raw.status,
        notes: raw.notes?.trim() || null,
      };
      this.saveChildren(this.maintenancesService.create(payload));
    }
  }

  private onStatusChange(status: MaintenanceStatus): void {
    this.currentStatus.set(status);
    this.applyHodometerValidators(status);
  }

  private applyHodometerValidators(status: MaintenanceStatus): void {
    const ctrl = this.form.controls.hodometerReading;
    // Um validador só, parametrizado: a gramática é a mesma nos dois estados, o que
    // muda é apenas se o vazio é aceito.
    ctrl.setValidators([hodometerValidator(status === 'DONE')]);
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * O PUT é replace total: um null enviado por descuido apagaria a leitura já
   * gravada. Só propaga null quando o usuário de fato mexeu no campo.
   */
  private hodometerForUpdate(value: string): number | null {
    const km = this.kmOf(value);
    if (km !== null) return km;
    if (this.form.controls.hodometerReading.pristine) return this.loadedHodometer();
    return null;
  }

  /**
   * Encadeia os anexos DEPOIS do save da manutenção, porque no cadastro a
   * entidade ainda não tem id: o `storage_path` é `{entidade}/{id}/…` e a FK
   * exige a linha do pai. Logo o upload não pode ser síncrono com o formulário
   * — é obrigatoriamente salvar primeiro, subir depois.
   *
   * `editingId` é promovido assim que a manutenção é salva. Sem isso, um
   * segundo submit depois de falha de anexo dispararia outro POST e cadastraria
   * a manutenção DUPLICADA; com o id setado o reenvio vira PUT da mesma
   * manutenção + retry só dos arquivos que faltaram.
   *
   * O filho trata o próprio erro e completa com `EMPTY`: uma falha de anexo NÃO
   * navega e NÃO cai no handler da manutenção, porque o POST/PUT já passou e o
   * usuário precisa saber que a manutenção existe.
   */
  private saveChildren(save$: Observable<Maintenance>): void {
    save$
      .pipe(
        tap((m) => {
          this.editingId.set(m.id);
          // A manutenção agora EXISTE, então a tela passou a ser edição de fato
          // e o veículo deixa de ser editável — igual ao caminho de edição por
          // rota (ngOnInit). Sem isto o select continuaria habilitado enquanto o
          // PUT do reenvio NÃO carrega `vehicleId`: o usuário trocaria o veículo,
          // salvaria, veria sucesso e a troca seria descartada em silêncio.
          this.form.controls.vehicleId.disable();
        }),
        switchMap((m) => this.documentsStep(m)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (m) => {
          this.saving.set(false);
          this.onSaved(m.id);
        },
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
  }

  /**
   * Sobe os pendentes UM A UM (`concatMap`, não `mergeMap`): o backend valida
   * tamanho, allowlist e magic bytes por requisição e conta o teto de 20 anexos
   * por manutenção, então disparar tudo em paralelo tornaria a mensagem de teto
   * não-determinística e o progresso ilegível.
   *
   * Cada sucesso REMOVE o seu item da fila. É essa remoção que faz o reenvio
   * mandar só o que faltou: sem ela, uma falha no terceiro arquivo faria o
   * retry subir o primeiro e o segundo de novo, duplicando anexo — e anexo
   * duplicado aqui é nota fiscal repetida no custo da manutenção.
   */
  private documentsStep(m: Maintenance): Observable<Maintenance> {
    if (this.pendingDocs().length === 0) return of(m);
    return from(this.pendingDocs()).pipe(
      concatMap((doc) =>
        this.maintenancesService.uploadDocument(m.id, doc.kind, doc.file).pipe(
          tap(() => this.pendingDocs.update((list) => list.filter((d) => d.uid !== doc.uid))),
        ),
      ),
      toArray(),
      map(() => m),
      catchError((err: HttpErrorResponse) => {
        this.handleDocumentsError(err);
        return EMPTY;
      }),
    );
  }

  /**
   * A manutenção FOI criada e o anexo não. A mensagem diz as duas coisas, nesta
   * ordem, porque o usuário que só lê "falhou" acha que perdeu o cadastro
   * inteiro e cadastra de novo.
   */
  private handleDocumentsError(err: HttpErrorResponse): void {
    this.saving.set(false);
    this.apiErrors.claim(err);
    const faltando = this.pendingDocs().length;
    const detalhe =
      err.status === 413
        ? 'O arquivo passou do limite de 20MB.'
        : (this.apiErrors.messageFor(err, 'Não foi possível enviar o documento.') ??
          'Não foi possível enviar o documento.');
    const plural = faltando === 1 ? 'arquivo continua' : 'arquivos continuam';
    this.error.set(
      `A manutenção foi salva. ${detalhe} ${faltando} ${plural} na lista — ` +
        'toque em salvar de novo para reenviar só o que faltou.',
    );
  }

  /** O slot é a afordância: tocá-lo registra o tipo e abre o seletor. */
  protected openDocPicker(kind: MaintenanceDocumentKind): void {
    if (this.saving()) return;
    this.error.set(null);
    this.pendingKind.set(kind);
    this.docPicker()?.nativeElement.click();
  }

  protected onDocSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    // Zera ANTES de qualquer retorno: sem isso, reescolher o MESMO arquivo
    // depois de um erro não dispara `change`.
    target.value = '';
    const kind = this.pendingKind();
    this.pendingKind.set(null);
    if (!file || !kind) return;

    if (!isAllowedMaintenanceDoc(file)) {
      this.error.set('Formato não suportado. Aceitos: PDF, JPG, PNG, WebP, HEIC/HEIF.');
      return;
    }
    if (file.size > MAINTENANCE_DOC_MAX_BYTES) {
      this.error.set(
        `O arquivo tem ${formatDocSize(file.size)} e o limite é 20MB. ` +
          'Fotografe o documento com menos resolução e escolha de novo.',
      );
      return;
    }

    // Reescolha do MESMO arquivo, no MESMO tipo: ignora em silêncio.
    //
    // O caso real é tocar no slot duas vezes e escolher o mesmo PDF — o segundo
    // toque não é "quero duas cópias", é hesitação. Sem esta guarda o arquivo
    // subiria duas vezes e a manutenção ficaria com a nota fiscal duplicada no
    // custo. A identidade é nome + tamanho + tipo: dois arquivos DIFERENTES
    // passam, e duas notas legítimas do mesmo `kind` (peça e mão de obra) têm
    // nomes diferentes e continuam convivendo — que é o caso normal aqui.
    const jaNaFila = this.pendingDocs().some(
      (d) => d.kind === kind && d.file.name === file.name && d.file.size === file.size,
    );
    if (jaNaFila) {
      this.error.set(null);
      return;
    }

    this.error.set(null);
    this.pendingSeq += 1;
    const uid = `pend-${this.pendingSeq}`;
    // ACRESCENTA. Escolher uma segunda nota fiscal não substitui a primeira:
    // peça e mão de obra saem de fornecedores diferentes.
    this.pendingDocs.update((list) => [...list, { uid, file, kind }]);
  }

  protected removePendingDoc(uid: string): void {
    if (this.saving()) return;
    this.pendingDocs.update((list) => list.filter((d) => d.uid !== uid));
  }

  protected pendingSizeText(doc: PendingMaintenanceDoc): string {
    return formatDocSize(doc.file.size);
  }

  protected pendingKindLabel(doc: PendingMaintenanceDoc): string {
    return MAINTENANCE_DOCUMENT_KIND_META[doc.kind];
  }

  private onSaved(id: string): void {
    this.notifications.success('Manutenção salva.');
    this.router.navigate(['/manutencoes', id]);
  }

  /**
   * Backend `fieldErrors` land inline under the matching control; only the leftover
   * goes to the form banner. Never a toast — `handleForm` claims the error.
   *
   * `items[0].name` chega aqui como caminho e o `applyFieldErrors` já o resolve para
   * `items.0.name`, então o erro cai na LINHA certa do `FormArray` sem trabalho extra.
   */
  private handleError(err: HttpErrorResponse): void {
    this.saving.set(false);
    const { formMessage } = this.apiErrors.handleForm(
      err,
      this.form,
      'Não foi possível salvar a manutenção.',
    );
    this.error.set(formMessage);
  }

  protected cancel(): void {
    if (this.isEdit()) {
      this.router.navigate(['/manutencoes', this.editingId()]);
    } else {
      this.router.navigate(['/manutencoes']);
    }
  }
}
