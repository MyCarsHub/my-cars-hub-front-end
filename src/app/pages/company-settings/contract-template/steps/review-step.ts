import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { KpiCard } from '../../../../components/kpi-card/kpi-card';
import { NotificationService } from '../../../../services/notification.service';
import {
  AUTENTIQUE_CLAUSE_TEXT,
  AUTENTIQUE_NOTICE_NOTE,
  AUTENTIQUE_NOTICE_TITLE,
} from '../autentique-clause';
import { LEGAL_DISCLAIMER } from '../ai/contract-ai.messages';
import { FieldOption } from '../ai/contract-ai.types';
import { ContractExistingFields } from '../contract-existing-fields';
import { ContractIcon } from '../contract-icon';

/** Última etapa dos dois caminhos: contagem, aviso de substituição e aviso jurídico. */
@Component({
  selector: 'app-contract-review-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-5' },
  imports: [ContractIcon, ContractExistingFields, KpiCard],
  template: `
    <div class="flex flex-col gap-1.5">
      <h3 data-step-heading tabindex="-1" class="m-0 text-xl font-bold leading-snug text-fg focus:outline-none">
        Tudo pronto! Confira e salve
      </h3>
      <p class="m-0 text-[15px] leading-relaxed text-fg-soft">
        Leia o contrato {{ where() }}. As partes
        <span class="rounded-[3px] border-b-2 border-emerald-500 bg-emerald-100 dark:bg-emerald-500/15 px-1 font-semibold text-emerald-900 dark:text-emerald-200">em verde</span>
        são preenchidas sozinhas em cada aluguel.
      </p>
    </div>
    <div class="grid grid-cols-2 gap-2.5" data-testid="review-counts">
      <div app-kpi-card data-testid="review-fields" variant="emerald" size="compact"
        [label]="fields() === 1 ? 'Dado preenchido sozinho' : 'Dados preenchidos sozinhos'"
        [countTo]="fields()" numberFormat="integer" class="enter-up [&>p:first-child]:normal-case [&>p:first-child]:tracking-normal [&>p:first-child]:text-sm [&>p:first-child]:whitespace-normal [&>p:first-child]:overflow-visible [&>p:first-child_.truncate]:whitespace-normal [&>p:first-child_.truncate]:overflow-visible"></div>
      <div app-kpi-card data-testid="review-clauses" variant="emerald" size="compact"
        [label]="clauses() === 1 ? 'Cláusula' : 'Cláusulas'"
        [countTo]="clauses()" numberFormat="integer" class="enter-up [&>p:first-child]:normal-case [&>p:first-child]:tracking-normal [&>p:first-child]:text-sm [&>p:first-child]:whitespace-normal [&>p:first-child]:overflow-visible [&>p:first-child_.truncate]:whitespace-normal [&>p:first-child_.truncate]:overflow-visible" style="--stagger-i: 1"></div>
    </div>
    <app-contract-existing-fields [fields]="existing()" />
    @if (unanswered().length > 0) {
      <section data-unanswered aria-labelledby="contract-unanswered-title"
        class="flex flex-col gap-2.5 rounded-2xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3.5 text-amber-950 dark:text-amber-100">
        <h4 id="contract-unanswered-title" class="m-0 text-[15px] font-semibold leading-snug">
          {{ unanswered().length === 1 ? '1 pergunta sem resposta' : unanswered().length + ' perguntas sem resposta' }}
        </h4>
        <p class="m-0 text-[13px] leading-snug">
          {{ unanswered().length === 1 ? 'Este dado fica' : 'Estes dados ficam' }} igual em todos os aluguéis.
          Para responder, volte às perguntas.
        </p>
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          @for (u of unanswered(); track u.id) {
            <li class="flex min-w-0 flex-col gap-0.5 text-[13px] leading-snug">
              <span class="font-semibold [overflow-wrap:anywhere]">{{ u.value }}</span>
              <span class="[overflow-wrap:anywhere]">{{ u.where }}</span>
            </li>
          }
        </ul>
      </section>
    }
    @if (readParagraph(); as text) {
      <p data-read-paragraph class="m-0 flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-3.5 py-3 text-[13px] leading-normal text-amber-950 dark:text-amber-100">
        <app-contract-icon name="info" [size]="16" class="mt-px" />
        <span class="min-w-0 [overflow-wrap:anywhere]">Leia este trecho: «{{ text }}». Se o nome ao lado continuar fixo, o contrato sai com o nome de uma pessoa e o documento de outra. Cabeçalho e rodapé não mudam.</span>
      </p>
    }
    @if (driverMissing()) {
      <p class="m-0 flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-3.5 py-3 text-[13px] leading-normal text-amber-950 dark:text-amber-100">
        <app-contract-icon name="info" [size]="16" class="mt-px" />
        <span>Este contrato vai sair sem o nome e o CPF do motorista de cada aluguel.</span>
      </p>
    }
    @if (esignatureMissing()) {
      <section data-testid="esignature-notice" aria-labelledby="contract-esign-title"
        class="enter-up flex flex-col gap-3 rounded-2xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3.5 text-amber-950 dark:text-amber-100">
        <h4 id="contract-esign-title" class="m-0 flex items-start gap-2.5 text-[15px] font-semibold leading-snug">
          <app-contract-icon name="info" [size]="16" class="mt-0.5" />{{ noticeTitle }}
        </h4>
        <p data-testid="esignature-clause" class="m-0 rounded-xl bg-surface/70 dark:bg-black/20 px-3.5 py-3 text-sm leading-relaxed [overflow-wrap:anywhere]">{{ clauseText }}</p>
        <button type="button" data-testid="esignature-copy" (click)="copyClause()"
          class="press inline-flex min-h-[48px] w-full items-center justify-center gap-2 self-start rounded-xl bg-amber-600 px-5 text-base font-semibold text-white hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 sm:w-auto">
          @if (copied()) {
            <span class="pop inline-flex"><app-contract-icon name="check" [size]="18" [stroke]="2.5" /></span>Copiado
          } @else {
            Copiar texto
          }
        </button>
        <p class="m-0 text-sm leading-snug">{{ noticeNote }}</p>
      </section>
    }
    <div class="flex flex-col gap-2">
      <span class="text-sm font-semibold text-fg-muted">Ao salvar</span>
      <ul class="m-0 flex list-none flex-col gap-2 p-0 text-[15px] leading-snug text-fg-body">
        @if (currentName(); as name) {
          <li class="flex items-start gap-2.5">
            <app-contract-icon name="refresh" [size]="18" class="mt-px text-fg-muted" />
            <span class="min-w-0 [overflow-wrap:anywhere]">Este contrato substitui «{{ name }}» nos próximos aluguéis.</span>
          </li>
          <li class="flex items-start gap-2.5">
            <app-contract-icon name="shield" [size]="18" class="mt-px text-emerald-700 dark:text-emerald-300" />
            <span>Os contratos já gerados não mudam.</span>
          </li>
        } @else {
          <li class="flex items-start gap-2.5">
            <app-contract-icon name="checkCircle" [size]="18" class="mt-px text-emerald-700 dark:text-emerald-300" />
            <span>Os próximos aluguéis já saem com este contrato, preenchido sozinho.</span>
          </li>
        }
      </ul>
    </div>
    <p class="m-0 flex items-start gap-2.5 rounded-xl bg-sky-50 dark:bg-sky-500/10 px-3.5 py-3 text-[13px] leading-normal text-sky-900 dark:text-sky-200">
      <app-contract-icon name="info" [size]="16" class="mt-px text-sky-700 dark:text-sky-300" />
      <span>{{ disclaimer }}</span>
    </p>
  `,
})
export class ContractReviewStep {
  readonly fields = input(0);
  readonly clauses = input(0);
  /** O que o contrato enviado já trazia: sem perguntas, aqui é o único lugar que mostra. */
  readonly existing = input<readonly FieldOption[]>([]);
  /** Perguntas sem resposta: o dado fica fixo. Texto já mascarado e legível. */
  readonly unanswered = input<readonly { id: string; value: string; where: string }[]>([]);
  /** Nenhum campo identifica o motorista: todo aluguel sairia sem dizer quem é. */
  readonly driverMissing = input(false);
  /** Trecho a reler: documento do motorista respondido, nome sem campo. */
  readonly readParagraph = input<string | null>(null);
  /** O contrato enviado não cita a assinatura eletrônica: sugere a cláusula (não bloqueia). */
  readonly esignatureMissing = input(false);
  readonly currentName = input<string | null>(null);
  readonly where = input('ao lado');
  protected readonly disclaimer = LEGAL_DISCLAIMER;
  protected readonly clauseText = AUTENTIQUE_CLAUSE_TEXT;
  protected readonly noticeTitle = AUTENTIQUE_NOTICE_TITLE;
  protected readonly noticeNote = AUTENTIQUE_NOTICE_NOTE;

  private readonly doc = inject(DOCUMENT);
  private readonly notify = inject(NotificationService);
  protected readonly copied = signal(false);

  /** Nunca finge que copiou: sem área de transferência, avisa. */
  protected async copyClause(): Promise<void> {
    try {
      const clipboard = this.doc.defaultView?.navigator?.clipboard;
      if (!clipboard?.writeText) throw new Error('sem clipboard');
      await clipboard.writeText(AUTENTIQUE_CLAUSE_TEXT);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.notify.warning('Não foi possível copiar. Selecione o texto e copie à mão.');
    }
  }
}
