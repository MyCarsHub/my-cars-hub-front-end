import { animate, style, transition, trigger } from '@angular/animations';
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
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { clearServerErrors } from '../../../services/api-error';
import { ApiErrorService } from '../../../services/api-error.service';
import { AdminService } from '../admin.service';

/** UUID canônico — o backend recebe o id do aluguel como `@PathVariable UUID`. */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Ferramentas operacionais do painel admin. Segue o padrão do "Testar templates":
 * card na grade de Áreas administrativas → diálogo, sem rota própria.
 *
 * MONO-FERRAMENTA por enquanto: expõe só regenerate-schedule, o único endpoint
 * operacional que existe no backend. O estado (`form`, `loading`, `error`,
 * `successMessage`, `confirmOpen`, `pendingRentalId`) e o texto da confirmação
 * são singulares e pertencem a essa ferramenta. Uma segunda ferramenta NÃO pode
 * simplesmente virar outra `<section>` aqui — ela herdaria o mesmo loading e o
 * mesmo banner; a estrutura precisa ser generalizada antes (estado por
 * ferramenta + confirmação parametrizada).
 *
 * Toda ação aqui é operacional/destrutiva: NUNCA dispara direto do botão, sempre
 * passa pelo `app-confirm-dialog`.
 */
@Component({
  selector: 'app-admin-ops-tools-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormField, FieldControl, AlertBanner, ConfirmDialog],
  animations: [
    trigger('backdrop', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('150ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('dialog', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' }),
        animate(
          '200ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 1, transform: 'scale(1) translateY(0)' }),
        ),
      ]),
      transition(':leave', [
        animate(
          '150ms cubic-bezier(0.4, 0, 0.2, 1)',
          style({ opacity: 0, transform: 'scale(0.95) translateY(-8px)' }),
        ),
      ]),
    ]),
  ],
  template: `
    @if (open()) {
      <!-- inert enquanto a confirmação está aberta: sem ele o painel hospedeiro
           continua clicável e tabulável por baixo, com dois aria-modal ativos. -->
      <div
        @backdrop
        class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        [attr.inert]="hostInert()"
        (click)="onCancel()"
        aria-hidden="true"
      ></div>

      <div
        @dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-ops-tools-title"
        aria-describedby="admin-ops-tools-description"
        [attr.inert]="hostInert()"
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 pointer-events-none"
      >
        <div
          class="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-neutral-100 w-full max-w-md pointer-events-auto overflow-y-auto max-h-[90vh]"
        >
          <div class="flex items-start gap-3 sm:gap-4 p-4 sm:p-6 pb-3 sm:pb-4">
            <div
              class="shrink-0 w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center"
              aria-hidden="true"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-amber-600"
              >
                <path
                  d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                />
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <h2
                id="admin-ops-tools-title"
                class="text-base font-semibold text-neutral-900 leading-snug"
              >
                Ferramentas operacionais
              </h2>
              <p
                id="admin-ops-tools-description"
                class="mt-1 text-sm text-neutral-500 leading-relaxed"
              >
                Ações de suporte executadas direto na plataforma. Toda ação pede confirmação antes
                de rodar.
              </p>
            </div>
          </div>

          <!-- Única ferramenta de hoje: regenerar cronograma de cobrança.
               Ver o comentário da classe antes de adicionar uma segunda. -->
          <section
            class="mx-4 sm:mx-6 mb-4 sm:mb-6 rounded-xl border border-neutral-200 p-3 sm:p-4"
            aria-labelledby="admin-ops-regenerate-title"
          >
            <h3 id="admin-ops-regenerate-title" class="text-sm font-semibold text-neutral-900">
              Regenerar cronograma de cobrança
            </h3>
            <p class="mt-1 text-xs text-neutral-500 leading-relaxed">
              Materializa as cobranças que faltam em um aluguel ativo. É idempotente: cobranças já
              existentes não são duplicadas nem apagadas.
            </p>

            <form [formGroup]="form" (ngSubmit)="onSubmit()" class="mt-3" novalidate>
              <app-form-field
                label="ID do aluguel"
                controlId="admin-ops-rental-id"
                hint="UUID do aluguel, como aparece na URL de detalhe."
                [required]="true"
                [control]="form.controls.rentalId"
                [messages]="rentalIdMessages"
              >
                <input
                  appFieldControl
                  formControlName="rentalId"
                  type="text"
                  inputmode="text"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  class="w-full min-h-[48px] px-3 py-2 rounded-xl border bg-white text-neutral-900 font-mono text-sm placeholder:text-neutral-400 placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 disabled:bg-neutral-50 disabled:text-neutral-500"
                />
              </app-form-field>

              @if (error(); as formError) {
                <app-alert-banner variant="error" [message]="formError" class="mt-3" />
              }
              @if (successMessage(); as ok) {
                <app-alert-banner variant="success" [message]="ok" class="mt-3" />
              }

              <button
                type="submit"
                [disabled]="loading()"
                class="mt-3 w-full min-h-[48px] px-4 py-2.5 text-sm font-semibold rounded-xl bg-amber-700 text-white hover:bg-amber-800 focus:ring-amber-700 transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 active:scale-[0.98] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                @if (loading()) {
                  <svg
                    class="animate-spin h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    ></circle>
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    ></path>
                  </svg>
                  <span>Regenerando…</span>
                } @else {
                  <span>Regenerar cronograma</span>
                }
              </button>
            </form>
          </section>

          <div class="px-4 sm:px-6 pb-4 sm:pb-6">
            <button
              type="button"
              (click)="onCancel()"
              [disabled]="loading()"
              class="w-full min-h-[48px] px-4 py-2.5 text-sm font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>

      <!-- O confirm usa z-40/z-50 internos, iguais aos do painel acima. Este wrapper
           posicionado cria um stacking context próprio em z-60, então backdrop e
           painel da confirmação sobem inteiros por cima do diálogo hospedeiro. -->
      <div class="relative z-60">
        <app-confirm-dialog
          [open]="confirmOpen()"
          variant="warning"
          title="Regenerar cronograma?"
          [message]="confirmMessage()"
          confirmLabel="Regenerar"
          cancelLabel="Cancelar"
          (confirmed)="onConfirmed()"
          (cancelled)="onConfirmCancelled()"
        />
      </div>
    }
  `,
})
export class AdminOpsToolsDialog {
  private readonly adminService = inject(AdminService);
  private readonly apiErrors = inject(ApiErrorService);

  readonly open = input.required<boolean>();
  readonly closed = output<void>();

  protected readonly form = new FormGroup({
    rentalId: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(UUID_PATTERN)],
    }),
  });

  protected readonly rentalIdMessages: Readonly<Record<string, string>> = {
    required: 'Informe o ID do aluguel.',
    pattern: 'ID inválido. Cole o UUID completo do aluguel.',
  };

  protected readonly loading = signal(false);
  /** Falha da ação. Banner inline dentro do diálogo — nunca toast. */
  protected readonly error = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly confirmOpen = signal(false);

  /** Alvo já validado e normalizado, congelado no momento em que a confirmação abriu. */
  private readonly pendingRentalId = signal<string | null>(null);

  protected readonly confirmMessage = computed(
    () =>
      `As cobranças faltantes do aluguel ${this.pendingRentalId() ?? ''} serão geradas agora. ` +
      'A ação é idempotente, mas afeta dados de cobrança em produção.',
  );

  /** `''` liga o atributo `inert`; `null` o remove. */
  protected readonly hostInert = computed(() => (this.confirmOpen() ? '' : null));

  constructor() {
    // O pai monta este componente incondicionalmente — fechar só destrói o @if do
    // template, não a instância. Sem este reset o UUID e o banner da execução
    // anterior reaparecem na reabertura e um clique distraído reexecuta a ação
    // sobre o aluguel errado.
    effect(() => {
      if (!this.open()) return;
      this.resetState();
    });
  }

  private resetState(): void {
    this.form.reset();
    clearServerErrors(this.form);
    this.loading.set(false);
    this.error.set(null);
    this.successMessage.set(null);
    this.confirmOpen.set(false);
    this.pendingRentalId.set(null);
  }

  protected onCancel(): void {
    if (this.loading()) return;
    this.closed.emit();
  }

  /** Submit apenas valida e abre a confirmação — nunca chama a API direto. */
  protected onSubmit(): void {
    if (this.loading()) return;

    this.error.set(null);
    this.successMessage.set(null);
    clearServerErrors(this.form);

    const control = this.form.controls.rentalId;
    const normalized = control.value.trim();
    if (normalized !== control.value) control.setValue(normalized);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.pendingRentalId.set(normalized);
    this.confirmOpen.set(true);
  }

  protected onConfirmCancelled(): void {
    this.confirmOpen.set(false);
    this.pendingRentalId.set(null);
  }

  protected onConfirmed(): void {
    this.confirmOpen.set(false);
    const rentalId = this.pendingRentalId();
    if (!rentalId || this.loading()) return;

    this.loading.set(true);
    this.adminService.regenerateRentalSchedule(rentalId).subscribe({
      next: (result) => {
        this.loading.set(false);
        this.pendingRentalId.set(null);
        // O diálogo não fecha no sucesso: o banner inline é o feedback. Nada de
        // toast aqui — seria a mesma frase duas vezes na mesma tela.
        this.successMessage.set(
          result.inserted > 0
            ? `${result.inserted} cobrança(s) geradas para o aluguel ${rentalId}.`
            : `Nada a gerar: o cronograma do aluguel ${rentalId} já estava completo.`,
        );
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.pendingRentalId.set(null);
        const { formMessage } = this.apiErrors.handleForm(
          err,
          this.form,
          'Não foi possível regenerar o cronograma. Confira o ID do aluguel.',
        );
        this.error.set(formMessage);
      },
    });
  }
}
