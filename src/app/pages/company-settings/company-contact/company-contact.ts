import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { PageCard } from '../../../components/core/page-card/page-card';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../../services/api-error.service';
import { clearServerErrors } from '../../../services/api-error';
import { CompanyContactService } from '../../../services/company-contact.service';
import { NotificationService } from '../../../services/notification.service';
import {
  CompanyContactPayload,
  CompanyContactSnapshot,
} from '../../../types/company-contact.types';
import { applyMaskedCepInput, maskCep } from '../../../utils/cep-mask';
import { applyMaskedPhoneInput, maskPhone } from '../../../utils/phone-mask';

const LOAD_FALLBACK = 'Não foi possível carregar os dados de contato da empresa.';
const SAVE_FALLBACK = 'Não foi possível salvar os dados de contato da empresa.';

/** Statuses que o `errorInterceptor` já mostra em toast — repetir no banner diria duas vezes. */
function ownedByInterceptor(status: number): boolean {
  return status === 0 || status === 401 || status === 403 || status >= 500;
}

/** `scrollIntoView` não existe no jsdom nem em alguns navegadores móveis antigos. */
function centre(element: HTMLElement | null): void {
  if (element && typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ block: 'center' });
  }
}

/** Trim local só para não mandar espaço à toa; o backend também normaliza. */
function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * Configurações → Dados de contato da empresa (`/configuracoes/contato`).
 *
 * Preenche as variáveis `{{companyPhone}}`, `{{companyEmail}}`, `{{companyAddress}}`,
 * `{{companyCep}}`, `{{companyRepresentative}}` e `{{companyRepresentativeRole}}` do
 * template de contrato. Campo vazio aqui sai vazio no contrato.
 *
 * Três decisões estruturais, todas por causa da semântica do backend:
 *
 * 1. **Rota e serviço próprios, fora de `CompanySettings`.** Aquela tela tem uma
 *    corrida conhecida (o `patchValue` do GET sobrescreve o que o usuário já
 *    digitou) e lê de um endpoint enquanto grava em outro — dois defeitos já na
 *    fila. Construir em cima deles seria fatal aqui, onde o `PUT` substitui o
 *    bloco inteiro: um campo perdido no caminho não fica em branco na tela, é
 *    APAGADO no banco.
 *
 * 2. **O formulário só existe depois que o GET responde.** Enquanto carrega, o
 *    template mostra esqueleto — não há campo para digitar, logo não há o que
 *    sobrescrever quando a resposta chega. A corrida não é contornada, ela deixa
 *    de ter janela. Falha no GET não rende formulário nenhum: sem o `name` real
 *    carregado, salvar renomearia a empresa (`name` é `@NotBlank` no `PUT`).
 *
 * 3. **O bloco vai sempre inteiro.** `buildPayload()` lista as onze chaves de
 *    propósito e `CompanyContactPayload` recusa em compilação um objeto parcial.
 *    Campo em branco viaja como `''` — é assim, e só assim, que o usuário limpa
 *    um valor.
 */
@Component({
  selector: 'app-company-contact',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    RouterLink,
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    FormField,
    FieldControl,
  ],
  templateUrl: './company-contact.html',
})
export class CompanyContact implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(CompanyContactService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);

  /**
   * O que o servidor devolveu no último carregamento (ou salvamento) bem-sucedido.
   * Guarda o `name`, que precisa voltar no `PUT`. `null` = nada carregado ainda,
   * e nesse estado salvar é proibido.
   */
  protected readonly snapshot = signal<CompanyContactSnapshot | null>(null);

  /**
   * Limites espelhados do backend (`CompanyContactDto`). Divergir daqui só
   * adiantaria o 400 para o cliente; o servidor continua sendo a autoridade.
   */
  protected readonly form = this.fb.nonNullable.group({
    contact: this.fb.nonNullable.group({
      phone: ['', [Validators.maxLength(30)]],
      email: ['', [Validators.email, Validators.maxLength(180)]],
      addressStreet: ['', [Validators.maxLength(180)]],
      addressNumber: ['', [Validators.maxLength(20)]],
      addressComplement: ['', [Validators.maxLength(120)]],
      addressDistrict: ['', [Validators.maxLength(120)]],
      // A máscara garante o hífen; `pattern` deixa passar o vazio, que é omissão válida.
      addressCep: ['', [Validators.pattern(/^\d{5}-\d{3}$/)]],
      addressCity: ['', [Validators.maxLength(120)]],
      // Exatamente duas letras: a coluna tem CHECK de 2 caracteres, então "S"
      // passaria por um `maxLength` e viraria erro só no servidor.
      addressUf: ['', [Validators.pattern(/^[A-Za-z]{2}$/)]],
      representativeName: ['', [Validators.maxLength(200)]],
      representativeRole: ['', [Validators.maxLength(120)]],
    }),
  });

  protected get contactGroup() {
    return this.form.controls.contact;
  }

  protected readonly phoneMessages: Readonly<Record<string, string>> = {
    maxlength: 'O telefone deve ter no máximo 30 caracteres.',
  };
  protected readonly emailMessages: Readonly<Record<string, string>> = {
    email: 'Informe um e-mail válido.',
    maxlength: 'O e-mail deve ter no máximo 180 caracteres.',
  };
  protected readonly cepMessages: Readonly<Record<string, string>> = {
    pattern: 'CEP inválido (00000-000).',
  };
  protected readonly ufMessages: Readonly<Record<string, string>> = {
    pattern: 'A UF deve ter exatamente 2 letras (ex.: SP).',
  };
  protected readonly streetMessages: Readonly<Record<string, string>> = {
    maxlength: 'O logradouro deve ter no máximo 180 caracteres.',
  };
  protected readonly numberMessages: Readonly<Record<string, string>> = {
    maxlength: 'O número deve ter no máximo 20 caracteres.',
  };
  protected readonly complementMessages: Readonly<Record<string, string>> = {
    maxlength: 'O complemento deve ter no máximo 120 caracteres.',
  };
  protected readonly districtMessages: Readonly<Record<string, string>> = {
    maxlength: 'O bairro deve ter no máximo 120 caracteres.',
  };
  protected readonly cityMessages: Readonly<Record<string, string>> = {
    maxlength: 'A cidade deve ter no máximo 120 caracteres.',
  };
  protected readonly representativeMessages: Readonly<Record<string, string>> = {
    maxlength: 'O nome deve ter no máximo 200 caracteres.',
  };
  protected readonly roleMessages: Readonly<Record<string, string>> = {
    maxlength: 'O cargo deve ter no máximo 120 caracteres.',
  };

  /** Sem snapshot não há `name` para devolver no `PUT` — salvar fica bloqueado. */
  protected readonly canSave = computed(() => this.snapshot() !== null && !this.saving());

  /** `true` quando a empresa nunca preencheu nada — vira aviso de contrato incompleto. */
  protected readonly neverFilled = signal(false);

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.saveError.set(null);

    this.service.load().subscribe({
      next: (snapshot) => {
        this.adopt(snapshot);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.snapshot.set(null);
        this.loadError.set(this.apiErrors.messageFor(err, LOAD_FALLBACK));
      },
    });
  }

  /** Máscara `(00) 00000-0000` com caret preservado. */
  protected onPhoneInput(event: Event): void {
    applyMaskedPhoneInput(event, this.contactGroup.controls.phone);
  }

  /** Máscara `00000-000` com caret preservado. */
  protected onCepInput(event: Event): void {
    applyMaskedCepInput(event, this.contactGroup.controls.addressCep);
  }

  protected save(): void {
    const snapshot = this.snapshot();
    if (!snapshot || this.saving()) return;

    clearServerErrors(this.form);
    this.saveError.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.revealFirstError();
      return;
    }

    this.saving.set(true);
    this.service.save(snapshot.name, this.buildPayload()).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.adopt(updated);
        this.notifications.success('Dados de contato atualizados.');
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const result = this.apiErrors.handleForm(err, this.form, SAVE_FALLBACK);
        this.saveError.set(ownedByInterceptor(err.status) ? null : result.formMessage);
        this.revealFirstError();
      },
    });
  }

  /**
   * Monta o bloco COMPLETO.
   *
   * As onze chaves estão escritas uma a uma de propósito: o `PUT` substitui o
   * bloco inteiro, então uma chave omitida aqui não vira "não mexe neste campo",
   * vira `NULL` no banco — apaga o que o usuário tinha salvo antes. O `''` de um
   * campo vazio é intencional e é o único jeito de limpar um valor.
   */
  private buildPayload(): CompanyContactPayload {
    const raw = this.form.getRawValue().contact;
    return {
      phone: clean(raw.phone),
      email: clean(raw.email),
      addressStreet: clean(raw.addressStreet),
      addressNumber: clean(raw.addressNumber),
      addressComplement: clean(raw.addressComplement),
      addressDistrict: clean(raw.addressDistrict),
      addressCep: clean(raw.addressCep),
      addressCity: clean(raw.addressCity),
      // Maiúsculas no cliente também: o backend faz o mesmo, mas assim o que
      // viaja é exatamente o que fica gravado.
      addressUf: clean(raw.addressUf).toUpperCase(),
      representativeName: clean(raw.representativeName),
      representativeRole: clean(raw.representativeRole),
    };
  }

  /**
   * Adota a resposta do servidor como verdade.
   *
   * Só é chamado com uma resposta em mãos (carregamento inicial ou salvamento),
   * nunca em paralelo com a digitação: enquanto o GET está em voo o formulário
   * não está na tela.
   */
  private adopt(snapshot: CompanyContactSnapshot): void {
    this.snapshot.set(snapshot);
    const contact = snapshot.contact;

    this.contactGroup.setValue({
      // Re-mascarado na hidratação para renderizar igual ao que o usuário digitaria.
      phone: maskPhone(contact.phone),
      email: contact.email ?? '',
      addressStreet: contact.addressStreet ?? '',
      addressNumber: contact.addressNumber ?? '',
      addressComplement: contact.addressComplement ?? '',
      addressDistrict: contact.addressDistrict ?? '',
      addressCep: maskCep(contact.addressCep),
      addressCity: contact.addressCity ?? '',
      addressUf: contact.addressUf ?? '',
      representativeName: contact.representativeName ?? '',
      representativeRole: contact.representativeRole ?? '',
    });
    this.form.markAsPristine();

    this.neverFilled.set(
      Object.values(contact).every((value) => value === null || value === ''),
    );
  }

  /**
   * Traz a primeira falha para a tela. O botão fica no fim de um formulário
   * longo: no celular, um salvamento recusado ficaria inteiramente fora de vista.
   * Campo inválido tem prioridade — focá-lo rola até ele e faz o leitor de tela
   * anunciar a mensagem `role="alert"` que o `app-form-field` monta.
   */
  private revealFirstError(): void {
    afterNextRender(
      () => {
        const invalid = this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (invalid) {
          invalid.focus();
          centre(invalid);
          return;
        }
        centre(this.host.nativeElement.querySelector<HTMLElement>('[data-save-error]'));
      },
      { injector: this.injector },
    );
  }
}
