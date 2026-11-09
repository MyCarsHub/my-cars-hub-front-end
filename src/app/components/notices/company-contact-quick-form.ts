import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subject, catchError, map, of, switchMap } from 'rxjs';
import { ApiErrorService } from '../../services/api-error.service';
import { CepService } from '../../services/cep.service';
import { CompanyContactService } from '../../services/company-contact.service';
import { NotificationService } from '../../services/notification.service';
import { SessionService } from '../../services/session.service';
import { CompanyContactPayload, CompanyContactSnapshot } from '../../types/company-contact.types';
import { applyMaskedCepInput, maskCep, normalizeCep } from '../../utils/cep-mask';
import { applyMaskedPhoneInput, maskPhone } from '../../utils/phone-mask';
import { AlertBanner } from '../alert-banner/alert-banner';
import { FieldControl, FormField } from '../form-field/form-field';

const LOAD_FALLBACK = 'Não foi possível carregar os dados da locadora.';
const SAVE_FALLBACK = 'Não foi possível salvar os dados de contato da locadora.';
const REQUIRED = 'Campo obrigatório.';

const INPUT_CLASS =
  'w-full min-h-[44px] bg-surface-muted border rounded-xl px-4 py-3 text-base text-fg-body focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600';

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * Formulário de contato da locadora para dentro de um aviso (FEAT-0563): o usuário completa os
 * dados SEM sair da tela em que estava (o aluguel em criação continua intacto atrás do aviso).
 *
 * Reaproveita o que a página `/configuracoes/contato` já usa: `CompanyContactService` (leitura e
 * `PUT` do bloco inteiro), `CepService` (autopreenchimento), máscaras de telefone/CEP e
 * `FormField`. Pré-preenche o que existe: dados já salvos; e-mail da conta; nome do usuário como
 * representante (o cargo fica em branco: é o usuário que diz).
 *
 * Exige os mesmos campos que o backend (`CompanyContactReadiness`): complemento e bairro opcionais.
 * Todos os controles têm 16px (sem zoom do iOS no foco) e alvo de 44px.
 */
@Component({
  selector: 'app-company-contact-quick-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormField, FieldControl, AlertBanner],
  template: `
    @if (loading()) {
      <p class="text-sm text-fg-subtle" role="status">Carregando dados da locadora…</p>
    } @else if (loadError(); as message) {
      <app-alert-banner variant="error" [message]="message" />
      <button
        type="button"
        class="press mt-3 min-h-[44px] rounded-xl px-4 text-base font-semibold text-primary-700 hover:bg-primary-50"
        (click)="reload()"
      >
        Tentar de novo
      </button>
    } @else {
      <form [formGroup]="form" (ngSubmit)="save()" class="grid grid-cols-1 gap-4" novalidate data-testid="contact-quick-form">
        <app-form-field label="Telefone" controlId="qc-phone" [required]="true" [control]="form.controls.phone" [messages]="m.phone">
          <input appFieldControl type="tel" inputmode="tel" autocomplete="tel" formControlName="phone"
                 placeholder="(00) 00000-0000" maxlength="15" (input)="onPhoneInput($event)" [class]="inputClass" />
        </app-form-field>

        <app-form-field label="E-mail" controlId="qc-email" [required]="true" [control]="form.controls.email" [messages]="m.email">
          <input appFieldControl type="email" inputmode="email" autocomplete="email" formControlName="email"
                 placeholder="contato@empresa.com.br" maxlength="180" [class]="inputClass" />
        </app-form-field>

        <app-form-field label="CEP" controlId="qc-cep" [required]="true" [hint]="cepHint()" [control]="form.controls.addressCep" [messages]="m.cep">
          <input appFieldControl type="text" inputmode="numeric" autocomplete="postal-code" formControlName="addressCep"
                 placeholder="00000-000" maxlength="9" (input)="onCepInput($event)" [class]="inputClass" />
        </app-form-field>

        <app-form-field label="Rua" controlId="qc-street" [required]="true" [control]="form.controls.addressStreet" [messages]="m.required">
          <input appFieldControl type="text" autocomplete="address-line1" formControlName="addressStreet" maxlength="180" [class]="inputClass" />
        </app-form-field>

        <div class="grid grid-cols-2 gap-4">
          <app-form-field label="Número" controlId="qc-number" [required]="true" [control]="form.controls.addressNumber" [messages]="m.required">
            <input appFieldControl type="text" autocomplete="address-line2" formControlName="addressNumber" maxlength="20" [class]="inputClass" />
          </app-form-field>
          <app-form-field label="Complemento" controlId="qc-complement" [control]="form.controls.addressComplement">
            <input appFieldControl type="text" formControlName="addressComplement" maxlength="120" [class]="inputClass" />
          </app-form-field>
        </div>

        <app-form-field label="Bairro" controlId="qc-district" [control]="form.controls.addressDistrict">
          <input appFieldControl type="text" formControlName="addressDistrict" maxlength="120" [class]="inputClass" />
        </app-form-field>

        <div class="grid grid-cols-3 gap-4">
          <app-form-field class="col-span-2" label="Cidade" controlId="qc-city" [required]="true" [control]="form.controls.addressCity" [messages]="m.required">
            <input appFieldControl type="text" autocomplete="address-level2" formControlName="addressCity" maxlength="120" [class]="inputClass" />
          </app-form-field>
          <app-form-field label="UF" controlId="qc-uf" [required]="true" [control]="form.controls.addressUf" [messages]="m.uf">
            <input appFieldControl type="text" autocomplete="address-level1" formControlName="addressUf" maxlength="2" [class]="inputClass + ' uppercase'" />
          </app-form-field>
        </div>

        <app-form-field label="Nome do representante" controlId="qc-rep" [required]="true" [control]="form.controls.representativeName" [messages]="m.required"
                        hint="Quem assina o contrato pela locadora.">
          <input appFieldControl type="text" autocomplete="name" formControlName="representativeName" maxlength="200" [class]="inputClass" />
        </app-form-field>

        <app-form-field label="Cargo do representante" controlId="qc-role" [required]="true" [control]="form.controls.representativeRole" [messages]="m.required">
          <input appFieldControl type="text" autocomplete="organization-title" formControlName="representativeRole" maxlength="120"
                 placeholder="Ex.: Sócio-administrador" [class]="inputClass" />
        </app-form-field>

        @if (saveError(); as message) {
          <app-alert-banner variant="error" [message]="message" />
        }

        <button
          type="submit"
          [disabled]="saving()"
          class="press min-h-[48px] w-full rounded-xl bg-primary-500 px-5 text-base font-semibold text-white hover:bg-primary-600 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          data-testid="contact-quick-save"
        >
          {{ saving() ? 'Salvando…' : 'Salvar e continuar' }}
        </button>
      </form>
    }
  `,
})
export class CompanyContactQuickForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(CompanyContactService);
  private readonly cepService = inject(CepService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly session = inject(SessionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Os dados foram salvos no servidor. */
  readonly saved = output<void>();

  protected readonly inputClass = INPUT_CLASS;
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly cepHint = signal('Preenche o endereço sozinho.');

  protected readonly m = {
    required: { required: REQUIRED },
    phone: { required: REQUIRED, maxlength: 'O telefone deve ter no máximo 30 caracteres.' },
    email: { required: REQUIRED, email: 'Informe um e-mail válido.' },
    cep: { required: REQUIRED, pattern: 'CEP inválido (00000-000).' },
    uf: { required: REQUIRED, pattern: 'Use 2 letras (ex.: SP).' },
  } as const;

  protected readonly form = this.fb.nonNullable.group({
    phone: ['', [Validators.required, Validators.maxLength(30)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(180)]],
    addressCep: ['', [Validators.required, Validators.pattern(/^\d{5}-\d{3}$/)]],
    addressStreet: ['', [Validators.required, Validators.maxLength(180)]],
    addressNumber: ['', [Validators.required, Validators.maxLength(20)]],
    addressComplement: ['', [Validators.maxLength(120)]],
    addressDistrict: ['', [Validators.maxLength(120)]],
    addressCity: ['', [Validators.required, Validators.maxLength(120)]],
    addressUf: ['', [Validators.required, Validators.pattern(/^[A-Za-z]{2}$/)]],
    representativeName: ['', [Validators.required, Validators.maxLength(200)]],
    representativeRole: ['', [Validators.required, Validators.maxLength(120)]],
  });

  private snapshot: CompanyContactSnapshot | null = null;
  private lastCep = '';
  private readonly cepQueries = new Subject<string>();

  ngOnInit(): void {
    this.cepQueries
      .pipe(
        switchMap((digits) =>
          this.cepService.lookup(digits).pipe(
            map((result) => ({ digits, result })),
            catchError(() => of({ digits, result: null })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ digits, result }) => {
        if (!result) {
          this.cepHint.set('CEP não encontrado. Preencha o endereço à mão.');
          return;
        }
        this.lastCep = digits;
        this.cepHint.set('Preenche o endereço sozinho.');
        const f = this.form.controls;
        this.form.patchValue({
          addressStreet: result.street || f.addressStreet.value,
          addressDistrict: result.district || f.addressDistrict.value,
          addressCity: result.city || f.addressCity.value,
          addressUf: result.uf || f.addressUf.value,
        });
        if (!f.addressNumber.value.trim()) {
          this.host.nativeElement.querySelector<HTMLElement>('#qc-number')?.focus();
        }
      });
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.service.load().subscribe({
      next: (snapshot) => {
        this.snapshot = snapshot;
        this.prefill(snapshot);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.loadError.set(this.apiErrors.messageFor(err, LOAD_FALLBACK));
      },
    });
  }

  /** O que já está salvo manda; o que falta é sugerido pela conta (e-mail, nome do dono). */
  private prefill(snapshot: CompanyContactSnapshot): void {
    const c = snapshot.contact;
    const identity = this.session.getIdentityFromToken();
    this.form.patchValue({
      phone: maskPhone(c.phone ?? ''),
      email: c.email ?? identity?.email ?? '',
      addressCep: maskCep(c.addressCep ?? ''),
      addressStreet: c.addressStreet ?? '',
      addressNumber: c.addressNumber ?? '',
      addressComplement: c.addressComplement ?? '',
      addressDistrict: c.addressDistrict ?? '',
      addressCity: c.addressCity ?? '',
      addressUf: c.addressUf ?? '',
      representativeName: c.representativeName ?? identity?.name ?? '',
      representativeRole: c.representativeRole ?? '',
    });
    this.lastCep = normalizeCep(c.addressCep ?? '');
  }

  protected onPhoneInput(event: Event): void {
    applyMaskedPhoneInput(event, this.form.controls.phone);
  }

  protected onCepInput(event: Event): void {
    applyMaskedCepInput(event, this.form.controls.addressCep);
    const digits = normalizeCep(this.form.controls.addressCep.value);
    if (digits.length === 8 && digits !== this.lastCep) {
      this.cepHint.set('Buscando endereço…');
      this.cepQueries.next(digits);
    }
  }

  protected save(): void {
    if (!this.snapshot || this.saving()) return;
    this.saveError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.host.nativeElement.querySelector<HTMLElement>('.ng-invalid[id]')?.focus();
      return;
    }
    this.saving.set(true);
    this.service.save(this.snapshot.name, this.payload()).subscribe({
      next: () => {
        this.saving.set(false);
        this.notifications.success('Dados de contato salvos.');
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set(this.apiErrors.messageFor(err, SAVE_FALLBACK));
      },
    });
  }

  /** O `PUT` substitui o bloco inteiro: as onze chaves vão sempre. */
  private payload(): CompanyContactPayload {
    const r = this.form.getRawValue();
    return {
      phone: clean(r.phone),
      email: clean(r.email),
      addressStreet: clean(r.addressStreet),
      addressNumber: clean(r.addressNumber),
      addressComplement: clean(r.addressComplement),
      addressDistrict: clean(r.addressDistrict),
      addressCep: clean(r.addressCep),
      addressCity: clean(r.addressCity),
      addressUf: clean(r.addressUf).toUpperCase(),
      representativeName: clean(r.representativeName),
      representativeRole: clean(r.representativeRole),
    };
  }
}
