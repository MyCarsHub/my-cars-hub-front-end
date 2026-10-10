import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { InviteShare } from '../../../components/invite-share/invite-share';
import { ApiErrorService } from '../../../services/api-error.service';
import { clearServerErrors } from '../../../services/api-error';
import { inviteErrorCopy } from '../../../services/invite-errors';
import { InvitesService } from '../../../services/invites.service';
import { SessionService } from '../../../services/session.service';
import {
  CreateInviteRequest,
  INVITE_TTL_LABEL,
  InviteResponse,
  withoutAcceptUrl,
} from '../../../types/invite.types';
import {
  applyMaskedDocumentInput,
  cpfShapeValidator,
  maskCpf,
  normalizeCpf,
} from '../../../utils/document-mask';
import { applyMaskedPhoneInput, normalizePhone } from '../../../utils/phone-mask';
import { companyRoleLabel } from '../../../utils/role-labels';
import { cpfValidator } from '../../../utils/validators/cpf.validator';
import { MembersIcon } from './members-icon';
import { MembersSheet } from './members-sheet';

/** Same pattern as the onboarding and the /convites form: DDD + number, masked or not. */
const PHONE_PATTERN = /^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$|^\d{10,11}$/;
const CREATE_FALLBACK = 'Não foi possível enviar o convite.';

/** Where a driver is invited today: the driver registration sends the invite on save. */
export const DRIVER_CREATE_ROUTE = '/motoristas/novo';

type Step = 'role' | 'manager' | 'sent';

/**
 * What the "sent" step shows. Lives in this component only, and only until the sheet
 * closes: the link is a credential-like value, so it is never written to storage, never
 * logged and never left in a service cache.
 */
interface SentInvite {
  email: string;
  link: string;
  companyName: string | null;
}

/**
 * "Convidar pessoa": step 1 picks the access level, step 2 is the manager form, step 3 (only
 * when the backend returned the accept link) confirms the e-mail and offers the link to copy
 * or send by WhatsApp.
 *
 * Drivers are NOT invited from here: the driver registration creates the invite when it is
 * saved, so the Motorista option explains that and links to it instead of submitting.
 * The caller sees Gerenciador whenever `canInviteManager` is true — owner AND manager, who
 * hold the same invite power. Without it only Motorista is offered (defensive: the page
 * never passes `false` to a role that can open it).
 *
 * The submit calls the EXISTING `POST /invites` with exactly the payload the /convites form
 * sends for a manager: trimmed e-mail and name, CPF and phone as digits.
 *
 * Without `acceptUrl` in the answer (an older backend) the sheet behaves as it always did:
 * it reports `sent` and asks to be closed. With it, the sheet STAYS OPEN on the "sent" step
 * and the link is dropped the moment `open` turns false.
 */
@Component({
  selector: 'app-invite-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlertBanner,
    FormField,
    FieldControl,
    InviteShare,
    MembersIcon,
    MembersSheet,
  ],
  template: `
    <app-members-sheet
      [open]="open()"
      [title]="sheetTitle()"
      [subtitle]="sheetSubtitle()"
      [showBack]="step() === 'manager'"
      (back)="step.set('role')"
      (closed)="closed.emit()"
    >
      @if (step() === 'role') {
        <div class="px-4 pb-4 space-y-3" role="group" aria-label="Nível de acesso">
          @if (canInviteManager()) {
            <button
              type="button"
              data-role-option="MANAGER"
              (click)="chooseManager()"
              class="w-full text-left flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 min-h-[72px]
                     hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            >
              <span class="shrink-0 p-2 rounded-lg bg-primary-low text-primary-700">
                <app-members-icon name="briefcase" />
              </span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-semibold text-neutral-900">{{ managerLabel }}</span>
                <span class="block text-xs text-neutral-600 mt-0.5 leading-relaxed">
                  Cuida da operação: veículos, aluguéis, motoristas, multas e vistorias.
                </span>
              </span>
              <span class="shrink-0 self-center text-neutral-400"><app-members-icon name="chevR" /></span>
            </button>
          }
          <button
            type="button"
            data-role-option="DRIVER"
            [attr.aria-pressed]="driverChosen()"
            (click)="driverChosen.set(true)"
            class="w-full text-left flex items-start gap-3 rounded-xl border p-4 min-h-[72px]
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            [class]="
              driverChosen()
                ? 'border-primary-500 bg-primary-50'
                : 'border-neutral-200 bg-white hover:bg-neutral-50'
            "
          >
            <span
              class="shrink-0 p-2 rounded-lg text-primary-700"
              [class]="driverChosen() ? 'bg-white' : 'bg-primary-low'"
            >
              <app-members-icon name="car" />
            </span>
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-semibold text-neutral-900">{{ driverLabel }}</span>
              <span class="block text-xs text-neutral-600 mt-0.5 leading-relaxed">
                Vê os próprios aluguéis e faz as vistorias do carro dele.
              </span>
            </span>
            <span class="shrink-0 self-center">
              @if (driverChosen()) {
                <span class="w-6 h-6 rounded-full bg-primary-500 text-white inline-flex items-center justify-center">
                  <app-members-icon name="check" [size]="14" />
                </span>
              } @else {
                <span class="text-neutral-400"><app-members-icon name="chevR" /></span>
              }
            </span>
          </button>
          @if (driverChosen()) {
            <div
              data-driver-banner
              role="status"
              class="rounded-xl border p-3 text-sm flex items-start gap-2 bg-blue-50 border-blue-200 text-blue-900"
            >
              <span class="shrink-0 mt-0.5 text-blue-600"><app-members-icon name="info" [size]="18" /></span>
              <div class="flex-1 min-w-0 break-words">
                <p class="font-semibold">Motoristas são convidados ao cadastrar o motorista.</p>
                <p class="text-xs mt-0.5 leading-relaxed">
                  Preencha o cadastro com o e-mail da pessoa. O convite sai automaticamente quando
                  você salvar.
                </p>
              </div>
            </div>
          }
        </div>
      } @else if (step() === 'sent') {
        @if (sentInvite(); as invite) {
          <div class="px-4 pb-4 space-y-4" data-invite-sent>
            <app-alert-banner variant="success">
              <p class="font-semibold break-all">Convite enviado para {{ invite.email }}.</p>
              <p class="text-xs mt-0.5 leading-relaxed">
                O e-mail já saiu e o convite vale por {{ ttlLabel }}. Se preferir, mande o link você
                mesmo.
              </p>
            </app-alert-banner>
            <app-invite-share [link]="invite.link" [companyName]="invite.companyName" />
          </div>
        }
      } @else {
        <form
          id="invite-manager-form"
          [formGroup]="form"
          (ngSubmit)="submit()"
          novalidate
          class="px-4 pb-4 space-y-4"
        >
          @if (createError(); as message) {
            <app-alert-banner variant="error" [message]="message" />
          }
          <app-form-field
            label="Nome completo"
            controlId="invite-name"
            [required]="true"
            [control]="form.controls.name"
            [messages]="nameMessages"
          >
            <input appFieldControl formControlName="name" type="text" autocomplete="name"
              maxlength="180" placeholder="Nome de quem vai gerenciar" [class]="inputClass" />
          </app-form-field>
          <app-form-field
            label="E-mail"
            controlId="invite-email"
            [required]="true"
            [control]="form.controls.email"
            [messages]="emailMessages"
          >
            <input appFieldControl formControlName="email" type="email" inputmode="email"
              autocomplete="email" spellcheck="false" maxlength="255"
              placeholder="pessoa@empresa.com.br" [class]="inputClass" />
          </app-form-field>
          <app-form-field
            label="CPF"
            controlId="invite-cpf"
            [required]="true"
            [control]="form.controls.cpf"
            [messages]="cpfMessages"
          >
            <input appFieldControl formControlName="cpf" type="text" inputmode="numeric"
              autocomplete="off" maxlength="14" placeholder="000.000.000-00"
              (input)="onCpfInput($event)" [class]="inputClass + ' tabular-nums'" />
          </app-form-field>
          <app-form-field
            label="Telefone"
            controlId="invite-phone"
            [required]="true"
            [control]="form.controls.phone"
            [messages]="phoneMessages"
          >
            <input appFieldControl formControlName="phone" type="tel" inputmode="tel"
              autocomplete="tel" maxlength="15" placeholder="(00) 00000-0000"
              (input)="onPhoneInput($event)" [class]="inputClass + ' tabular-nums'" />
          </app-form-field>
        </form>
      }

      <div sheetFooter>
        @if (step() === 'manager') {
          <div class="border-t border-neutral-100 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-2">
            <button
              type="submit"
              form="invite-manager-form"
              [disabled]="sending()"
              [attr.aria-busy]="sending() ? 'true' : null"
              class="min-h-12 w-full px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2
                     bg-primary-500 text-white hover:bg-primary-600 shadow-sm disabled:opacity-60
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            >
              <app-members-icon name="mail" [size]="18" />{{ sending() ? 'Enviando…' : 'Enviar convite' }}
            </button>
            <p class="text-xs text-neutral-500 leading-relaxed">Enviaremos um link por e-mail.</p>
          </div>
        } @else if (step() === 'sent') {
          <div class="border-t border-neutral-100 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <button
              type="button"
              data-invite-done
              (click)="closed.emit()"
              class="min-h-12 w-full px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center
                     bg-primary-500 text-white hover:bg-primary-600 shadow-sm
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            >
              Concluir
            </button>
          </div>
        } @else if (driverChosen()) {
          <div class="border-t border-neutral-100 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <a
              data-driver-create
              [routerLink]="driverRoute"
              class="min-h-12 w-full px-5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2
                     bg-primary-500 text-white hover:bg-primary-600 shadow-sm
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
            >
              Cadastrar motorista<app-members-icon name="arrowR" [size]="18" />
            </a>
          </div>
        } @else {
          <div class="h-2"></div>
        }
      </div>
    </app-members-sheet>
  `,
})
export class InviteSheet {
  private readonly fb = inject(FormBuilder);
  private readonly invites = inject(InvitesService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly session = inject(SessionService);

  readonly open = input.required<boolean>();
  /** OWNER and MANAGER. Without it the caller sees the Motorista option alone. */
  readonly canInviteManager = input(false);
  readonly closed = output<void>();
  /** The invite as the list stores it: the one-time link is NOT in this payload. */
  readonly sent = output<InviteResponse>();

  protected readonly step = signal<Step>('role');
  protected readonly driverChosen = signal(false);
  protected readonly sending = signal(false);
  protected readonly createError = signal<string | null>(null);
  protected readonly sentInvite = signal<SentInvite | null>(null);
  protected readonly ttlLabel = INVITE_TTL_LABEL;

  protected readonly managerLabel = companyRoleLabel('MANAGER');
  protected readonly sheetTitle = computed(() => {
    switch (this.step()) {
      case 'sent':
        return 'Convite enviado';
      case 'manager':
        return 'Convidar ' + this.managerLabel.toLowerCase();
      default:
        return 'Quem você quer convidar?';
    }
  });
  protected readonly sheetSubtitle = computed(() => {
    switch (this.step()) {
      case 'sent':
        return 'Copie o link ou envie pelo WhatsApp.';
      case 'manager':
        return 'Os dados são conferidos quando a pessoa aceitar.';
      default:
        return 'Escolha o nível de acesso da pessoa.';
    }
  });
  protected readonly driverLabel = companyRoleLabel('DRIVER');
  protected readonly driverRoute = DRIVER_CREATE_ROUTE;

  /** §4.2 control at 16px (`text-base`): below 16px iOS zooms the page on focus. */
  protected readonly inputClass =
    'w-full min-h-[44px] bg-white border rounded-xl px-3 text-base text-neutral-800 ' +
    'placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-400 ' +
    'focus:border-primary-400 disabled:opacity-60 disabled:cursor-not-allowed';

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(180)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
    // The control holds MASKED TEXT, so both validators read text.
    cpf: ['', [Validators.required, cpfShapeValidator(), cpfValidator()]],
    phone: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
  });

  protected readonly nameMessages = {
    required: 'Informe o nome de quem vai gerenciar.',
    maxlength: 'O nome deve ter no máximo 180 caracteres.',
  };
  protected readonly emailMessages = {
    required: 'Informe o e-mail de quem você quer convidar.',
    email: 'Informe um e-mail válido.',
    maxlength: 'O e-mail deve ter no máximo 255 caracteres.',
  };
  protected readonly cpfMessages = {
    required: 'Informe o CPF do gerenciador.',
    cpfShape: 'CPF inválido. Use o formato 000.000.000-00.',
    cpfInvalid: 'CPF inválido.',
  };
  protected readonly phoneMessages = {
    required: 'Informe o telefone do gerenciador.',
    pattern: 'Telefone inválido. Use DDD + número.',
  };

  constructor() {
    // Every opening starts at step 1. A caller with a single option has it pre-chosen.
    effect(() => {
      if (!this.open()) {
        // Closing is what drops the link: nothing on this component outlives the sheet.
        this.sentInvite.set(null);
        return;
      }
      this.step.set('role');
      this.driverChosen.set(!this.canInviteManager());
      this.createError.set(null);
    });
  }

  protected chooseManager(): void {
    if (!this.canInviteManager()) return;
    this.driverChosen.set(false);
    this.step.set('manager');
  }

  protected onCpfInput(event: Event): void {
    applyMaskedDocumentInput(event, this.form.controls.cpf, maskCpf);
  }

  protected onPhoneInput(event: Event): void {
    applyMaskedPhoneInput(event, this.form.controls.phone);
  }

  protected submit(): void {
    if (this.sending() || !this.canInviteManager()) return;
    clearServerErrors(this.form);
    this.createError.set(null);

    // Mobile keyboards append a space after an address; trim BEFORE validating.
    const email = this.form.controls.email;
    const trimmed = email.value.trim();
    if (trimmed !== email.value) email.setValue(trimmed);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const payload: CreateInviteRequest = {
      email: raw.email,
      role: 'MANAGER',
      name: raw.name.trim(),
      cpf: normalizeCpf(raw.cpf),
      phone: normalizePhone(raw.phone),
    };
    this.sending.set(true);
    this.invites.create(payload).subscribe({
      next: (invite) => {
        this.sending.set(false);
        this.form.reset();
        const link = invite.acceptUrl?.trim();
        const stored = withoutAcceptUrl(invite);
        if (link) {
          const company = this.session.getItem('selectedCompanyName')?.trim();
          this.sentInvite.set({ email: invite.email, link, companyName: company || null });
          this.step.set('sent');
          this.sent.emit(stored);
          return;
        }
        // No link in the answer: the e-mail was the only channel, so there is nothing to show.
        this.step.set('role');
        this.sent.emit(stored);
        this.closed.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.sending.set(false);
        // Invite statuses with their own copy go to the banner; 400 field errors go inline.
        const specific = inviteErrorCopy(err, 'manage');
        if (specific) {
          this.apiErrors.claim(err);
          this.createError.set(specific);
          return;
        }
        this.createError.set(this.apiErrors.handleForm(err, this.form, CREATE_FALLBACK).formMessage);
      },
    });
  }
}
