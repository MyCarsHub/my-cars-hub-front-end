import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { ActionsMenu } from '../../components/core/actions-menu/actions-menu';
import { BottomSheet } from '../../components/core/bottom-sheet/bottom-sheet';
import { ConfirmDialog } from '../../components/core/confirm-dialog/confirm-dialog';
import { PageCard } from '../../components/core/page-card/page-card';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { PersonNamePipe } from '../../pipes/person-name.pipe';
import { ApiErrorService } from '../../services/api-error.service';
import { DriverService } from '../../services/driver.service';
import { NotificationService } from '../../services/notification.service';
import {
  CONTACT_RELATIONSHIP_LABELS,
  CONTACT_RELATIONSHIP_OPTIONS,
  ContactRelationship,
  MAX_THIRD_PARTY_CONTACTS,
  ThirdPartyContact,
} from '../../types/driver.types';
import { formatPersonName } from '../../utils/display-format';

/**
 * Contatos de terceiros no detalhe do motorista: lista na ordem do servidor e, depois do
 * cadastro, acrescentar / editar / remover. Mesmo padrão das parcelas do IPVA no detalhe do
 * veículo: kebab por linha, folha (bottom sheet) para o formulário, confirmação para remover.
 *
 * Não guarda a lista: avisa `changed` e o detalhe recarrega o motorista — remover reordena no
 * servidor (os seguintes sobem uma posição), então a cópia local ficaria errada.
 */
@Component({
  selector: 'app-driver-contacts-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    AlertBanner,
    ActionsMenu,
    BottomSheet,
    ConfirmDialog,
    PageCard,
    FormField,
    FieldControl,
    PersonNamePipe,
  ],
  template: `
    <app-page-card title="Contatos de terceiros">
      <div class="p-4 sm:p-6 space-y-4">
        @if (actionError(); as failure) {
          <app-alert-banner variant="error" [message]="failure" />
        }

        @if (contacts().length === 0) {
          <p class="text-sm text-fg-subtle">Nenhum contato de terceiro cadastrado.</p>
        } @else {
          <ul class="space-y-4" data-third-party-contacts>
            @for (contact of contacts(); track contact.id ?? $index) {
              <li class="flex items-start justify-between gap-3" [attr.data-contact-row]="$index">
                <div class="min-w-0">
                  <p class="text-xs font-semibold text-fg-faint uppercase tracking-wider">
                    Contato {{ $index + 1 }}
                  </p>
                  <p class="text-fg font-medium break-words">{{ contact.fullName | personName }}</p>
                  <p class="text-sm text-fg-muted">
                    @if (relationshipLabel(contact); as kin) {
                      <span data-contact-relationship>{{ kin }}</span> ·
                    }
                    <span class="tabular-nums">{{ formatPhone(contact.phone) }}</span>
                  </p>
                </div>
                @if (contact.id) {
                  <app-actions-menu [label]="'Ações do contato ' + ($index + 1)">
                    <button
                      type="button"
                      role="menuitem"
                      data-contact-action="edit"
                      (click)="openEdit(contact)"
                      class="w-full text-left text-base px-4 py-3 text-fg-soft hover:bg-canvas min-h-[44px]"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-contact-action="remove"
                      (click)="askRemove(contact)"
                      class="w-full text-left text-base px-4 py-3 text-rose-700 dark:text-rose-300
                             hover:bg-canvas min-h-[44px]"
                    >
                      Remover
                    </button>
                  </app-actions-menu>
                }
              </li>
            }
          </ul>
        }

        @if (contacts().length < maxContacts) {
          <button
            type="button"
            data-contact-add
            (click)="openAdd()"
            class="press inline-flex min-h-[48px] items-center gap-2 rounded-xl px-2 text-base
                   font-semibold text-primary-700 dark:text-primary-400 hover:bg-primary-50
                   dark:hover:bg-primary-500/10 focus:outline-none focus-visible:ring-2
                   focus-visible:ring-primary-400"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.25" stroke-linecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Adicionar contato
          </button>
        }
      </div>
    </app-page-card>

    @if (sheet(); as kind) {
      <app-bottom-sheet
        [title]="kind === 'edit' ? 'Editar contato' : 'Adicionar contato'"
        [busy]="saving()"
        (closed)="onSheetClosed()"
      >
        <div class="space-y-4 pb-2" [attr.data-contact-sheet]="kind">
          @if (sheetError(); as failure) {
            <app-alert-banner variant="error" [message]="failure" />
          }
          <form
            [formGroup]="form"
            (ngSubmit)="submit()"
            id="driver-contact-form"
            class="space-y-4"
            novalidate
          >
            <app-form-field
              label="Nome completo"
              controlId="driver-contact-name"
              [required]="true"
              [control]="form.controls.fullName"
              [messages]="nameMessages"
            >
              <input
                appFieldControl
                type="text"
                maxlength="180"
                autocomplete="off"
                placeholder="Ex: Maria da Silva"
                formControlName="fullName"
                class="w-full px-4 py-3 rounded-xl border border-edge-field bg-surface text-fg
                       placeholder:text-fg-faint text-base min-h-[48px]
                       focus:ring-2 focus:ring-primary-600 focus:border-primary-600 transition-colors"
              />
            </app-form-field>

            <app-form-field
              label="Telefone"
              controlId="driver-contact-phone"
              [required]="true"
              [control]="form.controls.phone"
              [messages]="phoneMessages"
            >
              <input
                appFieldControl
                type="tel"
                inputmode="numeric"
                maxlength="15"
                placeholder="(11) 98765-4321"
                [value]="phoneDisplay()"
                (beforeinput)="onPhoneBeforeInput($event)"
                (input)="onPhoneInput($event)"
                class="w-full px-4 py-3 rounded-xl border border-edge-field bg-surface text-fg
                       placeholder:text-fg-faint text-base tabular-nums min-h-[48px]
                       focus:ring-2 focus:ring-primary-600 focus:border-primary-600 transition-colors"
              />
            </app-form-field>

            <app-form-field
              label="Grau de parentesco"
              controlId="driver-contact-relationship"
              [required]="true"
              [control]="form.controls.relationship"
              [messages]="relationshipMessages"
            >
              <select
                appFieldControl
                formControlName="relationship"
                class="w-full px-4 py-3 rounded-xl border border-edge-field bg-surface text-fg
                       text-base min-h-[48px]
                       focus:ring-2 focus:ring-primary-600 focus:border-primary-600 transition-colors"
              >
                <option value="">Selecione</option>
                @for (opt of relationships; track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
            </app-form-field>
          </form>
        </div>

        <div sheetFooter class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button
            type="button"
            (click)="requestCloseSheet()"
            [disabled]="saving()"
            class="press w-full sm:w-auto px-5 py-2.5 rounded-xl text-base font-semibold text-fg-soft
                   hover:bg-surface-sunken min-h-[48px] disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="driver-contact-form"
            data-contact-submit
            [disabled]="saving()"
            class="press w-full sm:w-auto px-6 py-2.5 rounded-xl text-white text-base font-semibold
                   bg-primary-500 hover:bg-primary-700 shadow-sm min-h-[48px]
                   disabled:opacity-60 disabled:cursor-not-allowed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600
                   focus-visible:ring-offset-2"
          >
            @if (saving()) {
              Salvando…
            } @else if (kind === 'edit') {
              Salvar
            } @else {
              Adicionar
            }
          </button>
        </div>
      </app-bottom-sheet>
    }

    <app-confirm-dialog
      [open]="removeTarget() !== null"
      title="Remover o contato?"
      [message]="removeMessage()"
      confirmLabel="Remover"
      cancelLabel="Voltar"
      variant="danger"
      [busy]="removing()"
      (confirmed)="confirmRemove()"
      (cancelled)="cancelRemove()"
    />
  `,
})
export class DriverContactsCard {
  private readonly driverService = inject(DriverService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(FormBuilder);

  readonly driverId = input.required<string>();
  readonly contacts = input<ThirdPartyContact[]>([]);
  /** Algo mudou no servidor — o detalhe recarrega o motorista. */
  readonly changed = output<void>();

  protected readonly maxContacts = MAX_THIRD_PARTY_CONTACTS;
  protected readonly relationships = CONTACT_RELATIONSHIP_OPTIONS;

  protected readonly nameMessages: Readonly<Record<string, string>> = {
    required: 'Informe o nome completo do contato.',
  };
  protected readonly phoneMessages: Readonly<Record<string, string>> = {
    required: 'Informe um telefone válido (10 ou 11 dígitos).',
    pattern: 'Informe um telefone válido (10 ou 11 dígitos).',
  };
  protected readonly relationshipMessages: Readonly<Record<string, string>> = {
    required: 'Informe o grau de parentesco.',
  };

  protected readonly form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.maxLength(180)]],
    phone: ['', [Validators.required, Validators.pattern(/^\d{10,11}$/)]],
    relationship: ['' as ContactRelationship | '', [Validators.required]],
  });

  protected readonly sheet = signal<'add' | 'edit' | null>(null);
  protected readonly saving = signal(false);
  protected readonly sheetError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly phoneDisplay = signal('');
  private readonly editing = signal<ThirdPartyContact | null>(null);
  /**
   * Telefone de contato antigo que não cabe na regra de hoje (mais de 11 dígitos, ex.: com DDI).
   * Enquanto o usuário não mexe no campo, ele volta ao servidor EXATAMENTE como estava — nada de
   * cortar dígitos em silêncio. Mexeu no campo: vale a regra normal (10 ou 11 dígitos).
   */
  private readonly legacyPhone = signal<string | null>(null);

  protected readonly removeTarget = signal<ThirdPartyContact | null>(null);
  protected readonly removing = signal(false);
  protected readonly removeMessage = computed(() => {
    const c = this.removeTarget();
    return c ? `Remover «${formatPersonName(c.fullName)}» dos contatos deste motorista?` : '';
  });

  private readonly sheetRef = viewChild(BottomSheet);

  protected relationshipLabel(contact: ThirdPartyContact): string | null {
    const code = contact.relationship;
    return code ? (CONTACT_RELATIONSHIP_LABELS[code] ?? null) : null;
  }

  protected openAdd(): void {
    if (this.contacts().length >= MAX_THIRD_PARTY_CONTACTS) return;
    this.form.reset({ fullName: '', phone: '', relationship: '' });
    this.setLegacyPhone(null);
    this.phoneDisplay.set('');
    this.openSheet('add', null);
  }

  /** Contato antigo chega sem parentesco: o select abre vazio e obriga a escolher. */
  protected openEdit(contact: ThirdPartyContact): void {
    const stored = contact.phone ?? '';
    const digits = stored.replace(/\D/g, '');
    const legacy = digits.length > 11 ? stored : null;
    this.form.reset({
      fullName: contact.fullName ?? '',
      phone: legacy ? digits : digits.slice(0, 11),
      relationship: contact.relationship ?? '',
    });
    this.setLegacyPhone(legacy);
    this.phoneDisplay.set(legacy ?? this.maskPhone(digits));
    this.openSheet('edit', contact);
  }

  private openSheet(kind: 'add' | 'edit', contact: ThirdPartyContact | null): void {
    this.sheetError.set(null);
    this.actionError.set(null);
    this.editing.set(contact);
    this.sheet.set(kind);
  }

  protected requestCloseSheet(): void {
    if (this.saving()) return;
    const ref = this.sheetRef();
    if (ref) ref.requestClose();
    else this.onSheetClosed();
  }

  protected onSheetClosed(): void {
    this.sheet.set(null);
    this.setLegacyPhone(null);
    this.editing.set(null);
    this.saving.set(false);
  }

  protected onPhoneBeforeInput(event: InputEvent): void {
    if (event.inputType === 'insertText' && event.data && !/^\d+$/.test(event.data)) {
      event.preventDefault();
    }
  }

  /** Liga/desliga o modo "telefone antigo intocado": sem a regra de 10–11 dígitos enquanto vale. */
  private setLegacyPhone(value: string | null): void {
    this.legacyPhone.set(value);
    const ctrl = this.form.controls.phone;
    ctrl.setValidators(
      value ? [Validators.required] : [Validators.required, Validators.pattern(/^\d{10,11}$/)],
    );
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  protected onPhoneInput(event: Event): void {
    if (this.legacyPhone()) this.setLegacyPhone(null);
    const raw = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 11);
    const ctrl = this.form.controls.phone;
    ctrl.setValue(raw);
    ctrl.markAsTouched();
    this.phoneDisplay.set(this.maskPhone(raw));
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    if (!raw.relationship) return;
    const payload = {
      fullName: raw.fullName.trim(),
      phone: this.legacyPhone() ?? raw.phone.trim(),
      relationship: raw.relationship,
    };
    const target = this.editing();
    const request: Observable<ThirdPartyContact> =
      this.sheet() === 'edit' && target?.id
        ? this.driverService.updateContact(this.driverId(), target.id, payload)
        : this.driverService.addContact(this.driverId(), payload);
    const success = this.sheet() === 'edit' ? 'Contato atualizado.' : 'Contato adicionado.';

    this.saving.set(true);
    this.sheetError.set(null);
    request.subscribe({
      next: () => {
        this.notifications.success(success);
        this.saving.set(false);
        const ref = this.sheetRef();
        if (ref) ref.requestClose(true);
        else this.onSheetClosed();
        this.changed.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const { formMessage } = this.apiErrors.handleForm(
          err,
          this.form,
          'Não foi possível salvar o contato.',
        );
        this.sheetError.set(formMessage);
      },
    });
  }

  protected askRemove(contact: ThirdPartyContact): void {
    this.actionError.set(null);
    this.removeTarget.set(contact);
  }

  protected cancelRemove(): void {
    if (!this.removing()) this.removeTarget.set(null);
  }

  protected confirmRemove(): void {
    const target = this.removeTarget();
    if (!target?.id || this.removing()) return;
    this.removing.set(true);
    this.driverService.deleteContact(this.driverId(), target.id).subscribe({
      next: () => {
        this.removing.set(false);
        this.removeTarget.set(null);
        this.notifications.success('Contato removido.');
        this.changed.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.removing.set(false);
        this.removeTarget.set(null);
        this.actionError.set(this.apiErrors.messageFor(err, 'Não foi possível remover o contato.'));
      },
    });
  }

  /** Máscara progressiva enquanto digita — mesma do cadastro (driver-form). */
  private maskPhone(digits: string): string {
    const d = digits.slice(0, 11);
    if (d.length === 0) return '';
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  }

  protected formatPhone(phone: string | null | undefined): string {
    const d = (phone ?? '').replace(/\D/g, '');
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return phone ?? '—';
  }
}
