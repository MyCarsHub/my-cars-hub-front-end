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
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  EMPTY,
  Observable,
  catchError,
  concatMap,
  from,
  map,
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
import { DriverService } from '../../services/driver.service';
import { CepService } from '../../services/cep.service';
import {
  CreateDriverRequest,
  DRIVER_DOCUMENT_KIND_META,
  DriverDocumentKind,
  DriverResponse,
  DriverStatus,
  LicenseCategory,
  MAX_THIRD_PARTY_CONTACTS,
  UpdateDriverRequest,
} from '../../types/driver.types';
import { DRIVER_STATUS_META } from '../../utils/status-maps';
import { isValidCpf } from '../../utils/validators/cpf.validator';
import {
  DOCUMENT_ACCEPT,
  MAX_DOCUMENT_BYTES,
  formatDocumentSize,
  isAllowedDocumentFile,
} from './driver-document-file-rules';

const CATEGORIES: LicenseCategory[] = ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'];
const STATUSES: Array<{ value: DriverStatus; label: string }> = (
  ['AVAILABLE', 'WORKING', 'SUSPENDED'] as DriverStatus[]
).map((v) => ({ value: v, label: DRIVER_STATUS_META[v].label }));
const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

/**
 * Complemento do banner quando o envio de um anexo falha sem mensagem do
 * servidor. Fica no fim da frase — o prefixo ("O motorista foi salvo, mas …")
 * é montado em `handleDocumentsError`. Mesmo contrato do `vehicle-form`.
 */
const CHILD_RETRY_HINT = 'Tente novamente em instantes.';

/**
 * Slots oferecidos no CADASTRO, na ordem em que aparecem (fixa, como no card
 * de documentos do detalhe). `APP_RIDE_RECEIPT` fica DE FORA de propósito: o
 * portão desse slot é `DriverResponse.isAppDriver`, e no cadastro o motorista
 * ainda não existe — sem resposta não há flag, e o portão falha FECHADO
 * (mesma regra do card). O extrato entra depois, pela tela de detalhe.
 */
const CADASTRO_SLOT_DEFS: ReadonlyArray<{ kind: DriverDocumentKind; hint: string }> = [
  { kind: 'CNH', hint: 'Frente e verso.' },
  { kind: 'ADDRESS_PROOF', hint: 'Conta de luz, água ou internet dos últimos meses.' },
  { kind: 'INCOME_PROOF', hint: 'Holerite, extrato bancário ou declaração.' },
  { kind: 'OTHER', hint: 'Qualquer outro arquivo do motorista.' },
];

/**
 * Arquivo escolhido no cadastro, ainda não (ou já) enviado. `sent` é a memória
 * do retry: depois de uma falha parcial, o reenvio sobe SÓ o que tem
 * `sent: false` — reenviar o que já subiu duplicaria o anexo no motorista.
 */
interface PendingDriverFile {
  id: number;
  kind: DriverDocumentKind;
  file: File;
  sent: boolean;
}

/** Bloco repetível de contato de terceiro (FEAT-0067) — máx. 3, ver types. */
type ThirdPartyContactGroup = FormGroup<{
  fullName: FormControl<string>;
  phone: FormControl<string>;
}>;

@Component({
  selector: 'app-driver-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    PrimaryInput,
    AlertBanner,
    FormField,
    FieldControl,
  ],
  templateUrl: './driver-form.html',
})
export class DriverForm implements OnInit {
  private readonly driverService = inject(DriverService);
  private readonly cepService = inject(CepService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly categories = CATEGORIES;
  protected readonly statuses = STATUSES;
  protected readonly ufs = UFS;

  protected readonly editingId = signal<string | null>(null);
  protected readonly isEdit = computed(() => this.editingId() !== null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly cepLoading = signal(false);

  /**
   * O bloco de anexos existe só no fluxo de CADASTRO, mas a decisão vem da
   * ROTA, não de `isEdit()`: quando um anexo falha, `editingId` é promovido e
   * `isEdit()` vira `true` com o form ainda montado — se o bloco dependesse
   * dele, sumiria exatamente na hora do retry, levando junto os arquivos que
   * faltam subir.
   */
  protected readonly canAttachDocuments = this.route.snapshot.paramMap.get('id') === null;

  protected readonly documentAccept = DOCUMENT_ACCEPT;

  /** Arquivos escolhidos no cadastro, enviados como elo filho do submit. */
  protected readonly pendingFiles = signal<PendingDriverFile[]>([]);
  private nextPendingFileId = 1;

  /**
   * ALVO do seletor de arquivos — a intenção do toque, não estado de envio.
   * Mesmo conserto do card de documentos: o diálogo nativo pode ser dispensado
   * sem escolher nada, então nada de "Enviando" aqui.
   */
  private readonly pendingKind = signal<DriverDocumentKind | null>(null);

  private readonly docPicker = viewChild<ElementRef<HTMLInputElement>>('docPicker');

  /**
   * Um slot por tipo oferecido no cadastro. UM arquivo por tipo (regra de
   * produto — a CNH é um arquivo só, frente e verso juntos): escolher de novo
   * SUBSTITUI o pendente; o que já subiu (`sent`) tranca o slot, porque o
   * arquivo pertence ao motorista e sai só pelo card do detalhe.
   */
  protected readonly documentSlots = computed(() =>
    CADASTRO_SLOT_DEFS.map((def) => {
      const files = this.pendingFiles().filter((f) => f.kind === def.kind);
      return {
        kind: def.kind,
        hint: def.hint,
        label: DRIVER_DOCUMENT_KIND_META[def.kind],
        files,
        sent: files.some((f) => f.sent),
      };
    }),
  );

  /** Copy overrides per validator key for the `app-form-field` message resolver. */
  protected readonly nameMessages: Readonly<Record<string, string>> = {
    required: 'Informe o nome do motorista.',
  };
  protected readonly rgMessages: Readonly<Record<string, string>> = {
    required: 'Informe o RG.',
  };
  protected readonly emailMessages: Readonly<Record<string, string>> = {
    required: 'Informe um e-mail válido.',
    email: 'Informe um e-mail válido.',
  };
  protected readonly phoneMessages: Readonly<Record<string, string>> = {
    required: 'Informe um telefone válido (10 ou 11 dígitos).',
    pattern: 'Informe um telefone válido (10 ou 11 dígitos).',
  };
  protected readonly cepMessages: Readonly<Record<string, string>> = {
    required: 'CEP inválido (00000-000).',
    pattern: 'CEP inválido (00000-000).',
  };
  protected readonly streetMessages: Readonly<Record<string, string>> = {
    required: 'Informe a rua.',
  };
  protected readonly districtMessages: Readonly<Record<string, string>> = {
    required: 'Informe o bairro.',
  };
  protected readonly cityMessages: Readonly<Record<string, string>> = {
    required: 'Informe a cidade.',
  };
  protected readonly ufMessages: Readonly<Record<string, string>> = {
    required: 'Selecione a UF.',
    pattern: 'Selecione a UF.',
  };
  protected readonly licenseNumberMessages: Readonly<Record<string, string>> = {
    required: 'Informe o número da CNH.',
    pattern: 'A CNH deve ter 11 caracteres.',
  };
  protected readonly licenseExpiryMessages: Readonly<Record<string, string>> = {
    required: 'Informe a data de vencimento.',
  };
  protected readonly documentMessages: Readonly<Record<string, string>> = {
    required: 'CPF: 11 dígitos. CNPJ: 14 dígitos.',
    pattern: 'CPF: 11 dígitos. CNPJ: 14 dígitos.',
    cpfInvalid: 'CPF inválido.',
  };
  protected readonly contactNameMessages: Readonly<Record<string, string>> = {
    required: 'Informe o nome completo do contato.',
  };

  // Máscaras visuais — o form control guarda só dígitos (telefone) / alfanumérico (CNH/doc).
  protected readonly phoneDisplay = signal('');
  protected readonly licenseDisplay = signal('');
  protected readonly documentDisplay = signal('');
  protected readonly rgDisplay = signal('');

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(180)]],
    rg: ['', [Validators.required, Validators.maxLength(10)]],
    userId: [''],
    document: this.fb.nonNullable.group({
      type: ['CPF' as 'CPF' | 'CNPJ', [Validators.required]],
      value: ['', [
        Validators.required,
        Validators.pattern(/^[A-Z0-9]{11,14}$/),
        (ctrl: AbstractControl) => {
          const type = ctrl.parent?.get('type')?.value;
          if (type !== 'CPF' || !ctrl.value) return null;
          return isValidCpf(String(ctrl.value)) ? null : { cpfInvalid: true };
        },
      ]],
    }),
    contact: this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email, Validators.maxLength(180)]],
      phone: ['', [Validators.required, Validators.pattern(/^\d{10,11}$/)]],
    }),
    address: this.fb.nonNullable.group({
      cep: ['', [Validators.required, Validators.pattern(/^\d{5}-?\d{3}$/)]],
      street: ['', [Validators.required, Validators.maxLength(180)]],
      number: [''],
      complement: [''],
      district: ['', [Validators.required, Validators.maxLength(120)]],
      city: ['', [Validators.required, Validators.maxLength(120)]],
      uf: ['', [Validators.required, Validators.pattern(/^[A-Z]{2}$/)]],
    }),
    licenseNumber: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{11}$/)]],
    licenseCategory: ['B' as LicenseCategory, [Validators.required]],
    licenseExpiry: ['', [Validators.required]],
    status: ['AVAILABLE' as DriverStatus, [Validators.required]],
    // FEAT-0067 — até 3 blocos {nome, telefone}. Dentro do form de propósito:
    // um contato meio-preenchido invalida o submit como qualquer outro campo.
    thirdPartyContacts: this.fb.array<ThirdPartyContactGroup>([]),
  });

  protected get contactsArray() {
    return this.form.controls.thirdPartyContacts;
  }

  protected readonly maxContacts = MAX_THIRD_PARTY_CONTACTS;

  /**
   * Máscara visual dos telefones dos contatos, uma entrada por bloco (mesmo
   * padrão do telefone principal: o control guarda só dígitos). Sinal próprio
   * porque FormArray não é sinal e o template precisa reagir a add/remove.
   */
  protected readonly contactPhoneDisplays = signal<string[]>([]);

  /** Quantos blocos existem — dirige o botão "+ Adicionar contato" e o teto. */
  protected readonly contactCount = computed(() => this.contactPhoneDisplays().length);

  private contactGroup(): ThirdPartyContactGroup {
    return this.fb.nonNullable.group({
      fullName: ['', [Validators.required, Validators.maxLength(180)]],
      // Validação idêntica ao telefone principal do form.
      phone: ['', [Validators.required, Validators.pattern(/^\d{10,11}$/)]],
    });
  }

  protected addContact(): void {
    if (this.saving() || this.isEdit()) return;
    if (this.contactsArray.length >= MAX_THIRD_PARTY_CONTACTS) return;
    this.contactsArray.push(this.contactGroup());
    this.contactPhoneDisplays.update((list) => [...list, '']);
  }

  protected removeContact(index: number): void {
    if (this.saving() || this.isEdit()) return;
    this.contactsArray.removeAt(index);
    this.contactPhoneDisplays.update((list) => list.filter((_, i) => i !== index));
  }

  protected onContactPhoneInput(index: number, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 11);
    const ctrl = this.contactsArray.at(index).controls.phone;
    ctrl.setValue(raw);
    ctrl.markAsTouched();
    const masked = this.formatPhone(raw);
    this.contactPhoneDisplays.update((list) =>
      list.map((v, i) => (i === index ? masked : v)),
    );
  }

  ngOnInit(): void {
    // Re-run CPF validation on document.value when type flips between CPF/CNPJ.
    this.form.controls.document.controls.type.valueChanges.subscribe(() => {
      this.form.controls.document.controls.value.updateValueAndValidity();
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editingId.set(id);
      this.loadDriver(id);
      this.form.controls.document.disable();
    }
  }

  protected onPhoneBeforeInput(event: InputEvent): void {
    // Bloqueia caracteres não-numéricos ANTES de entrarem no DOM (evita flash de letra).
    // Paste (insertFromPaste) passa direto — o (input) faz o strip.
    if (event.inputType === 'insertText' && event.data && !/^\d+$/.test(event.data)) {
      event.preventDefault();
    }
  }

  protected onPhoneInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 11);
    this.form.controls.contact.controls.phone.setValue(raw);
    this.form.controls.contact.controls.phone.markAsTouched();
    this.phoneDisplay.set(this.formatPhone(raw));
  }

  protected onLicenseInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 11);
    this.form.controls.licenseNumber.setValue(raw);
    this.form.controls.licenseNumber.markAsTouched();
    this.licenseDisplay.set(raw);
  }

  protected onRgInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10);
    this.form.controls.rg.setValue(raw);
    this.form.controls.rg.markAsTouched();
    this.rgDisplay.set(this.formatRg(raw));
  }

  private formatRg(digits: string): string {
    const d = digits.slice(0, 10);
    if (d.length === 0) return '';
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
    if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}-${d.slice(8)}`;
  }

  protected onDocumentInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 14);
    this.form.controls.document.controls.value.setValue(raw);
    this.form.controls.document.controls.value.markAsTouched();
    this.documentDisplay.set(raw);
  }

  private formatPhone(digits: string): string {
    const d = digits.slice(0, 11);
    if (d.length === 0) return '';
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  }

  private loadDriver(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.driverService.getOne(id).subscribe({
      next: (driver) => {
        const phoneDigits = (driver.contact.phone ?? '').replace(/\D/g, '').slice(0, 11);
        const licenseRaw = (driver.licenseNumber ?? '').toUpperCase().slice(0, 11);
        const documentRaw = (driver.document.value ?? '').toUpperCase().slice(0, 14);
        const rgDigits = (driver.rg ?? '').replace(/\D/g, '').slice(0, 10);
        this.phoneDisplay.set(this.formatPhone(phoneDigits));
        this.licenseDisplay.set(licenseRaw);
        this.documentDisplay.set(documentRaw);
        this.rgDisplay.set(this.formatRg(rgDigits));
        this.form.patchValue({
          name: driver.name,
          rg: rgDigits,
          userId: driver.userId ?? '',
          document: {
            type: driver.document.type ?? 'CPF',
            value: driver.document.value ?? '',
          },
          contact: {
            email: driver.contact.email,
            phone: phoneDigits,
          },
          address: {
            cep: driver.address.cep,
            street: driver.address.street,
            number: driver.address.number ?? '',
            complement: driver.address.complement ?? '',
            district: driver.address.district,
            city: driver.address.city,
            uf: driver.address.uf,
          },
          licenseNumber: licenseRaw,
          licenseCategory: driver.licenseCategory,
          licenseExpiry: driver.licenseExpiry,
          status: driver.status,
        });
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.apiErrors.messageFor(err, 'Motorista não encontrado.'));
        this.loading.set(false);
      },
    });
  }

  protected onCepBlur(): void {
    const cep = this.form.controls.address.controls.cep.value;
    const digits = (cep ?? '').replace(/\D/g, '');
    if (digits.length !== 8) return;
    this.cepLoading.set(true);
    this.cepService.lookup(digits).subscribe({
      next: (res) => {
        this.cepLoading.set(false);
        if (!res) return;
        this.form.controls.address.patchValue({
          street: res.street || this.form.controls.address.controls.street.value,
          district: res.district || this.form.controls.address.controls.district.value,
          city: res.city || this.form.controls.address.controls.city.value,
          uf: res.uf || this.form.controls.address.controls.uf.value,
        });
      },
      error: () => this.cepLoading.set(false),
    });
  }

  /**
   * O slot É a afordância: tocá-lo registra o tipo e abre o seletor. Slot com
   * arquivo JÁ ENVIADO não abre — o anexo pertence ao motorista e sai pelo
   * card do detalhe. Slot com pendente abre normalmente: a escolha SUBSTITUI.
   */
  protected openDocPicker(kind: DriverDocumentKind): void {
    if (this.saving()) return;
    if (this.pendingFiles().some((f) => f.kind === kind && f.sent)) return;
    this.pendingKind.set(kind);
    this.docPicker()?.nativeElement.click();
  }

  protected onDocFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    // Zera o input ANTES de qualquer retorno: sem isso, escolher o MESMO
    // arquivo de novo depois de um erro não dispara `change`.
    target.value = '';
    const kind = this.pendingKind();
    this.pendingKind.set(null);
    if (!file || !kind) return;

    if (!isAllowedDocumentFile(file)) {
      this.error.set('Formato não suportado. Aceitos: PDF, JPG, PNG, WebP, HEIC/HEIF.');
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      this.error.set(
        `O arquivo tem ${formatDocumentSize(file.size)} e o limite é 20MB. ` +
          'Fotografe o documento com menos resolução e escolha de novo.',
      );
      return;
    }

    // UM arquivo por tipo. Já enviado tranca (o anexo pertence ao motorista);
    // pendente é SUBSTITUÍDO no lugar — nunca uma segunda linha do mesmo tipo.
    const existing = this.pendingFiles().find((f) => f.kind === kind);
    if (existing?.sent) {
      this.error.set(
        `${DRIVER_DOCUMENT_KIND_META[kind]} já foi enviado. ` +
          'Remova ou substitua pelo detalhe do motorista.',
      );
      return;
    }

    this.error.set(null);
    if (existing) {
      this.pendingFiles.update((list) =>
        list.map((f) => (f.id === existing.id ? { ...f, file } : f)),
      );
      return;
    }
    this.pendingFiles.update((list) => [
      ...list,
      { id: this.nextPendingFileId++, kind, file, sent: false },
    ]);
  }

  protected removePendingFile(id: number): void {
    if (this.saving()) return;
    // Só arquivos ainda não enviados têm botão de remover — o que já subiu
    // pertence ao motorista e sai pelo card de documentos do detalhe.
    this.pendingFiles.update((list) => list.filter((f) => f.id !== id || f.sent));
  }

  protected pendingSizeText(item: PendingDriverFile): string {
    return formatDocumentSize(item.file.size);
  }

  protected slotAriaLabel(label: string, count: number, sent = false): string {
    if (sent) return `${label} — documento já enviado. Gerencie pelo detalhe do motorista.`;
    if (count === 0) return `Anexar ${label} — nenhum arquivo escolhido`;
    return `Substituir ${label} — escolher outro arquivo substitui o atual`;
  }

  protected removeAriaLabel(item: PendingDriverFile): string {
    return `Remover ${item.file.name}`;
  }

  protected removeContactAriaLabel(index: number): string {
    return `Remover contato ${index + 1}`;
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Verifique os campos destacados e tente novamente.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    clearServerErrors(this.form);

    const raw = this.form.getRawValue();
    const addressPayload = {
      street: raw.address.street.trim(),
      number: raw.address.number?.trim() || null,
      complement: raw.address.complement?.trim() || null,
      district: raw.address.district.trim(),
      cep: raw.address.cep.trim(),
      city: raw.address.city.trim(),
      uf: raw.address.uf.toUpperCase(),
    };
    const contactPayload = {
      email: raw.contact.email.trim(),
      phone: raw.contact.phone.trim(),
    };
    const commonPayload = {
      name: raw.name.trim(),
      rg: raw.rg ? raw.rg.replace(/\D/g, '') || null : null,
      userId: raw.userId?.trim() ? raw.userId.trim() : null,
      address: addressPayload,
      contact: contactPayload,
      licenseNumber: raw.licenseNumber.trim(),
      licenseCategory: raw.licenseCategory,
      licenseExpiry: raw.licenseExpiry,
      status: raw.status,
    };

    if (this.isEdit()) {
      const payload: UpdateDriverRequest = commonPayload;
      this.saveChildren(this.driverService.update(this.editingId()!, payload));
    } else {
      const payload: CreateDriverRequest = {
        ...commonPayload,
        document: {
          type: raw.document.type,
          value: raw.document.value.trim(),
        },
        // Dentro do POST, nunca uma chamada separada (contrato FEAT-0066).
        // A ordem do array é a ordem de exibição — o servidor a preserva.
        thirdPartyContacts: raw.thirdPartyContacts.map((c) => ({
          fullName: c.fullName.trim(),
          phone: c.phone.trim(),
        })),
      };
      this.saveChildren(this.driverService.create(payload));
    }
  }

  /**
   * Encadeia os anexos escolhidos no cadastro depois do save do motorista,
   * espelhando `vehicle-form.saveChildren()`. Uma falha de anexo trata o
   * próprio erro inline e completa com `EMPTY` — não navega nem dispara o
   * handler do motorista, porque o POST/PUT do motorista JÁ passou e o
   * usuário precisa saber disso.
   *
   * `editingId` é promovido assim que o motorista é salvo: na CRIAÇÃO, se um
   * anexo falhar o form continua montado, e sem isso o próximo submit
   * dispararia outro POST /drivers, cadastrando o motorista DUPLICADO. Com o
   * id setado o reenvio vira PUT do mesmo motorista + retry só dos anexos que
   * faltaram (`sent: false`).
   */
  private saveChildren(save$: Observable<DriverResponse>): void {
    const hadPendingUploads = this.pendingFiles().some((f) => !f.sent);
    save$
      .pipe(
        tap((driver) => {
          this.editingId.set(driver.id);
          // A promoção também trava o CPF/CNPJ, como na rota de edição: o
          // retry faz PUT, e `UpdateDriverRequest` NÃO carrega `document` —
          // deixar o campo editável descartaria a alteração em silêncio.
          //
          // `emitEvent: false` é obrigatório: o `disable()` do grupo marca o
          // status DISABLED e SÓ DEPOIS desabilita os filhos; o valueChanges
          // do `type` aciona o revalidador do CPF (ngOnInit), cujo
          // `updateValueAndValidity()` sobe ao grupo enquanto `value` ainda
          // está habilitado — e reescreve o status do grupo para VALID.
          this.form.controls.document.disable({ emitEvent: false });
          // Contatos de terceiros também: eles JÁ subiram dentro do POST e o
          // PUT do retry não os carrega — editáveis, uma alteração seria
          // descartada em silêncio (mesma razão do CPF/CNPJ acima).
          this.form.controls.thirdPartyContacts.disable({ emitEvent: false });
        }),
        switchMap((driver) => this.documentsStep(driver)),
      )
      .subscribe({
        next: (driver) => {
          this.saving.set(false);
          this.notifications.success(
            hadPendingUploads ? 'Motorista salvo e documentos enviados.' : 'Motorista salvo.',
          );
          this.router.navigate(['/motoristas', driver.id]);
        },
        error: (err: HttpErrorResponse) => this.handleError(err),
      });
  }

  /**
   * Sobe os anexos UM POR CHAMADA (contrato do endpoint), em sequência, e SÓ
   * os que ainda têm `sent: false` — no retry, o que já subiu não é reenviado.
   * A primeira falha interrompe a fila: os arquivos restantes continuam
   * pendentes e sobem no próximo submit.
   */
  private documentsStep(driver: DriverResponse): Observable<DriverResponse> {
    const queue = this.pendingFiles().filter((f) => !f.sent);
    if (queue.length === 0) return of(driver);
    return from(queue).pipe(
      concatMap((item) =>
        this.driverService
          .uploadDocument(driver.id, item.kind, item.file)
          .pipe(tap(() => this.markSent(item.id))),
      ),
      // `toArray()` em vez de `last()`: espera a fila completar sem a
      // possibilidade teórica de `EmptyError` vazar para o handler de anexo.
      toArray(),
      map(() => driver),
      catchError((err: HttpErrorResponse) => {
        this.handleDocumentsError(err);
        return EMPTY;
      }),
    );
  }

  private markSent(id: number): void {
    this.pendingFiles.update((list) =>
      list.map((f) => (f.id === id ? { ...f, sent: true } : f)),
    );
  }

  /**
   * Falha no envio de um anexo. O prefixo é obrigatório: quando o anexo falha
   * o motorista JÁ foi salvo (POST/PUT 2xx), e omitir isso é o que levaria o
   * usuário a reenviar o formulário achando que nada tinha gravado (mesmo
   * contrato de `vehicle-form.childErrorMessage`). Não há form para
   * `fieldErrors` de upload — `claim` segura o toast da rede de segurança e o
   * detalhe do servidor vai para o banner.
   */
  private handleDocumentsError(err: HttpErrorResponse): void {
    this.saving.set(false);
    this.apiErrors.claim(err);
    const remaining = this.pendingFiles().filter((f) => !f.sent).length;
    const head = 'O motorista foi salvo, mas nem todos os documentos foram enviados.';
    const detail =
      err.status === 413
        ? 'O arquivo passou do limite de 20MB. Reduza a qualidade e envie de novo.'
        : this.apiErrors.messageFor(err, CHILD_RETRY_HINT);
    const tail =
      remaining === 1
        ? 'Salvar de novo envia apenas o arquivo que faltou.'
        : `Salvar de novo envia apenas os ${remaining} arquivos que faltaram.`;
    this.error.set(`${head} ${detail} ${tail}`);
  }

  /**
   * Backend `fieldErrors` (e.g. `licenseNumber` when the CNH is already registered)
   * land on the matching controls; only what is left over goes to the form banner.
   * Never a toast — `handleForm` claims the error so the safety net stays quiet.
   */
  private handleError(err: HttpErrorResponse): void {
    this.saving.set(false);
    const { formMessage } = this.apiErrors.handleForm(
      err,
      this.form,
      'Não foi possível salvar o motorista.',
    );
    this.error.set(formMessage);
  }

  protected cancel(): void {
    if (this.isEdit()) {
      this.router.navigate(['/motoristas', this.editingId()]);
    } else {
      this.router.navigate(['/motoristas']);
    }
  }
}
