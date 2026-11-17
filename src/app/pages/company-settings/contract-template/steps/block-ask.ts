import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { fieldLabel, safeText } from '../ai/contract-ai.messages';
import { BlockAnswer, BlockItemView, BlockView, Party } from '../ai/contract-ai.types';
import { ContractIcon } from '../contract-icon';
import { QuoteParts, quoteOf, readable } from '../contract-paper.model';

/** As respostas no vocabulário do dono (estudo 3.3 e decisões de 16/11). */
const PARTY_TEXT: Readonly<Record<Party, { title: string; hint: string; noun: string }>> = {
  DRIVER: { title: 'Do Motorista (Locatário)', hint: 'quem aluga o carro', noun: 'do Motorista' },
  COMPANY: {
    title: 'Da Locadora',
    hint: 'locador, dono, representante ou a própria locadora',
    noun: 'da Locadora',
  },
  THIRD: {
    title: 'Contato de terceiro do motorista',
    hint: 'Um dos contatos cadastrados no motorista (referência 1 a 3)',
    noun: 'de um contato de terceiro do motorista',
  },
};

/** Nome do dado na lista do bloco. */
const KIND_LABELS: Readonly<Record<string, string>> = {
  NAME: 'Nome',
  CPF: 'CPF',
  RG: 'RG',
  CNH: 'CNH',
  CNPJ: 'CNPJ',
  PHONE: 'Telefone',
  CEP: 'CEP',
  EMAIL: 'E-mail',
  ADDRESS: 'Endereço',
  ROLE: 'Cargo',
  NATIONALITY: 'Nacionalidade',
  MARITAL: 'Estado civil',
};

/** Título pelo dado quando o bloco tem um só («Este endereço é de quem?»). */
const KIND_TITLES: Readonly<Record<string, string>> = {
  NAME: 'Este nome é de quem?',
  CPF: 'Este CPF é de quem?',
  RG: 'Este RG é de quem?',
  CNH: 'Esta CNH é de quem?',
  CNPJ: 'Este CNPJ é de quem?',
  PHONE: 'Este telefone é de quem?',
  CEP: 'Este CEP é de quem?',
  EMAIL: 'Este e-mail é de quem?',
  ADDRESS: 'Este endereço é de quem?',
};

export const KEEP_BLOCK: BlockAnswer = 'NONE';

interface ItemRow {
  id: string;
  label: string;
  value: string;
  /** Campo que o dado vira com a parte proposta/escolhida; `null` = fica como está. */
  field: string | null;
  fieldLabel: string | null;
}

/**
 * Uma pergunta da etapa «Campos» feita por BLOCO de dados de pessoa: confirmar o bloco que o
 * contrato já diz de quem é («Está certo» / «Corrigir») ou escolher a parte de um bloco sem
 * título nem rótulo. A resposta vale para todos os dados do bloco. Nada vem marcado: a sugestão da
 * leitura só ganha o selo «Parece ser esta».
 */
@Component({
  selector: 'app-contract-block-ask',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  imports: [ContractIcon],
  styles: `
    .doc-serif {
      font-family: Cambria, 'Times New Roman', 'Noto Serif', serif;
    }
  `,
  template: `
    <div class="flex flex-col gap-1.5">
      <h3 data-step-heading tabindex="-1" class="m-0 text-xl font-bold leading-snug text-fg break-words focus:outline-none sm:text-2xl">
        {{ heading() }}
      </h3>
      @if (where(); as w) {
        <p data-block-where class="m-0 text-[13px] font-semibold text-fg-muted">{{ w }}</p>
      }
      <p class="m-0 text-[15px] leading-relaxed text-fg-soft">{{ explain() }}</p>
    </div>

    @if (isConfirm()) {
      <ul data-block-items class="m-0 flex list-none flex-col gap-3 rounded-2xl bg-surface-muted px-4 py-3.5 p-0">
        @for (row of rows(); track row.id) {
          <li class="flex min-w-0 flex-col gap-1">
            <span class="text-[13px] font-semibold text-fg-muted">{{ row.label }}</span>
            <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="doc-serif text-base text-fg [overflow-wrap:anywhere]">{{ row.value }}</span>
              <span [class]="chipClass(row.field)">{{ row.field ? fieldName(row) : 'Fica como está' }}</span>
            </span>
          </li>
        }
      </ul>
      <div role="radiogroup" aria-label="Estes dados estão certos?" class="flex flex-col gap-2.5 sm:flex-row">
        <button type="button" role="radio" data-block-ok
          [attr.aria-checked]="confirmed()"
          (click)="answer(block().party!)"
          [class]="cardClass(confirmed())" class="sm:flex-1">
          <span aria-hidden="true" [class]="dotClass(confirmed())">@if (confirmed()) {<span class="h-2.5 w-2.5 rounded-full bg-surface"></span>}</span>
          <span class="text-base font-semibold text-fg">Está certo</span>
        </button>
        <button type="button" role="radio" data-block-fix
          [attr.aria-checked]="correcting()"
          (click)="fixing.set(true)"
          [class]="cardClass(correcting())" class="sm:flex-1">
          <span aria-hidden="true" [class]="dotClass(correcting())">@if (correcting()) {<span class="h-2.5 w-2.5 rounded-full bg-surface"></span>}</span>
          <span class="text-base font-semibold text-fg">Corrigir</span>
        </button>
      </div>
    } @else {
      @if (quote(); as q) {
        <figure class="m-0 flex flex-col gap-1.5">
          <figcaption class="text-[13px] font-semibold text-fg-muted">Está assim no seu contrato:</figcaption>
          <blockquote class="m-0 rounded-xl bg-amber-50/50 dark:bg-amber-500/10 px-3.5 py-2.5 doc-serif text-base leading-relaxed text-fg-body break-words">
            <!-- Uma linha só: espaço entre os spans viraria espaço no texto do contrato. -->@if (q.cutBefore) {<span>…</span>}<span>{{ q.before }}</span><mark class="rounded-[3px] border-b-2 border-amber-500 bg-amber-100 dark:bg-amber-500/15 px-0.5 font-bold text-fg">{{ q.hit }}</mark><span>{{ q.after }}</span>@if (q.cutAfter) {<span>…</span>}
          </blockquote>
        </figure>
      }
      @if (aiHint(); as hint) {
        <p data-block-ai class="m-0 flex items-start gap-2.5 text-[15px] leading-normal text-fg-soft">
          <app-contract-icon name="sparkles" [size]="18" class="mt-0.5 text-fg-muted" />
          <span>{{ hint }}</span>
        </p>
      }
    }

    @if (showOptions()) {
      <div role="radiogroup" [attr.aria-label]="isConfirm() ? 'De quem são estes dados?' : 'Escolha uma resposta'" class="flex flex-col gap-2.5">
        @for (o of options(); track o.party) {
          <button type="button" role="radio" [attr.data-party]="o.party"
            [attr.aria-checked]="current() === o.party"
            (click)="answer(o.party)"
            [class]="cardClass(current() === o.party)">
            <span aria-hidden="true" [class]="dotClass(current() === o.party)">@if (current() === o.party) {<span class="h-2.5 w-2.5 rounded-full bg-surface"></span>}</span>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="text-base font-semibold text-fg">{{ o.title }}</span>
                @if (o.suggested) {
                  <span class="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-[13px] font-semibold text-amber-900 dark:text-amber-200"><app-contract-icon name="sparkles" [size]="12" [stroke]="2.5" />Parece ser esta</span>
                }
              </span>
              <span class="text-[15px] leading-snug text-fg-muted">{{ o.hint }}</span>
            </span>
          </button>
        }
        <button type="button" role="radio" data-party="NONE"
          [attr.aria-checked]="current() === 'NONE'"
          (click)="answer('NONE')"
          class="inline-flex min-h-[48px] items-center gap-2.5 self-start rounded-xl px-2 text-left text-[15px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          [class]="current() === 'NONE' ? 'text-fg' : 'text-fg-soft hover:bg-surface-sunken'">
          <span aria-hidden="true" [class]="dotClass(current() === 'NONE')">@if (current() === 'NONE') {<span class="h-2.5 w-2.5 rounded-full bg-surface"></span>}</span>
          Não é de nenhum dos dois: deixar fixo
        </button>
      </div>
    }

    @if (current() === 'THIRD' && referenceItems().length > 0) {
      @for (item of referenceItems(); track item.id) {
        <div role="radiogroup" [attr.aria-label]="'Qual contato do motorista é ' + item.value + '?'" data-block-reference class="flex flex-col gap-2">
          <p class="m-0 text-[15px] font-semibold text-fg">Qual contato do motorista é «{{ item.value }}»?</p>
          <div class="flex flex-wrap gap-2">
            @for (f of item.fields; track f.field) {
              <button type="button" role="radio" [attr.aria-checked]="references()[item.id] === f.field"
                (click)="reference.emit({ itemId: item.id, field: f.field })"
                class="press inline-flex min-h-[44px] items-center rounded-xl border-2 px-3.5 text-base font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                [class]="references()[item.id] === f.field ? 'border-primary-500 bg-surface text-fg' : 'border-edge bg-surface text-fg-soft hover:border-neutral-400 dark:hover:border-neutral-500'">
                {{ f.short }}
              </button>
            }
            <button type="button" role="radio" [attr.aria-checked]="!references()[item.id]"
              (click)="reference.emit({ itemId: item.id, field: null })"
              class="press inline-flex min-h-[44px] items-center rounded-xl border-2 px-3.5 text-base font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              [class]="!references()[item.id] ? 'border-primary-500 bg-surface text-fg' : 'border-edge bg-surface text-fg-soft hover:border-neutral-400 dark:hover:border-neutral-500'">
              Deixar o nome fixo
            </button>
          </div>
        </div>
      }
      <p class="m-0 text-[13px] leading-snug text-fg-muted">Com o nome como referência, o telefone desta pessoa passa a vir do cadastro do motorista. O CPF fica escrito como está.</p>
    }

    @if (!isConfirm()) {
      <div class="flex flex-col gap-2">
        <button type="button" data-block-reach (click)="reachOpen.set(!reachOpen())" [attr.aria-expanded]="reachOpen()"
          [attr.aria-controls]="'block-reach-' + block().id"
          class="inline-flex min-h-[44px] items-center gap-2 self-start rounded-xl px-2 text-left text-[15px] text-fg-body transition-colors hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
          <span>Esta resposta vale para <strong>{{ reachText() }}</strong></span>
          <app-contract-icon name="chevronDown" [size]="16" class="text-fg-muted transition-transform" [class.rotate-180]="reachOpen()" />
        </button>
        @if (reachOpen()) {
          <ul [id]="'block-reach-' + block().id" class="m-0 flex list-none flex-col gap-3 rounded-2xl bg-surface-muted px-4 py-3.5 p-0">
            @for (row of rows(); track row.id) {
              <li class="flex min-w-0 flex-col gap-0.5">
                <span class="text-[13px] font-semibold text-fg-muted">{{ row.label }}</span>
                <span class="doc-serif text-base text-fg [overflow-wrap:anywhere]">{{ row.value }}</span>
              </li>
            }
          </ul>
        }
      </div>
    } @else {
      <p class="m-0 text-[15px] text-fg-soft">Esta resposta vale para <strong>{{ reachText() }}</strong>.</p>
    }
  `,
})
export class ContractBlockAsk {
  readonly block = input.required<BlockView>();
  /** Resposta gravada; `null` = sem resposta (os dados ficam fixos). */
  readonly answered = input<BlockAnswer | null>(null);
  /** Terceiro: referência escolhida por dado (`driverReference1..3`). */
  readonly references = input<Readonly<Record<string, string | undefined>>>({});

  readonly answer$ = output<BlockAnswer>({ alias: 'answer' });
  readonly reference = output<{ itemId: string; field: string | null }>();

  protected readonly fixing = signal(false);
  protected readonly reachOpen = signal(false);

  protected readonly isConfirm = computed(() => this.block().kind === 'CONFIRM' && !!this.block().party);
  protected readonly current = computed(() => this.answered());
  /** CONFIRM respondido com a parte que o contrato deu. */
  protected readonly confirmed = computed(
    () => this.isConfirm() && this.answered() === this.block().party && !this.fixing(),
  );
  /** «Corrigir» aberto, ou já respondido com outra parte. */
  protected readonly correcting = computed(
    () =>
      this.isConfirm() &&
      (this.fixing() || (this.answered() !== null && this.answered() !== this.block().party)),
  );
  protected readonly showOptions = computed(() => !this.isConfirm() || this.correcting());

  protected readonly heading = computed(() => {
    const b = this.block();
    if (this.isConfirm() && b.party) return `Encontramos estes dados ${PARTY_TEXT[b.party].noun}`;
    const kinds = new Set(b.items.map((i) => i.kind));
    if (kinds.size === 1) {
      const t = KIND_TITLES[b.items[0]?.kind ?? ''];
      if (t) return b.items.length === 1 ? t : 'Estes dados são de quem?';
    }
    return 'Estes dados são de quem?';
  });

  /** Seção ou rótulo do contrato onde o bloco está. */
  protected readonly where = computed(() => {
    const b = this.block();
    const name = readable(safeText(b.label ?? b.sectionPath.at(-1) ?? '')).trim();
    if (!name) return null;
    return b.label ? `No contrato: «${name}»` : `Seção: ${name}`;
  });

  protected readonly explain = computed(() => {
    const b = this.block();
    if (this.isConfirm()) {
      return 'Um toque em «Está certo» confirma o bloco inteiro. Sem resposta, estes dados ficam como estão no contrato.';
    }
    if (b.kind === 'CONFLICT') {
      return 'O contrato liga estes dados a duas partes diferentes. Escolha de quem são. Sem resposta, eles ficam como estão.';
    }
    return 'Não achamos nenhum título ou rótulo perto dele dizendo de quem é. Por isso estamos perguntando.';
  });

  protected readonly options = computed(() => {
    const b = this.block();
    return b.options
      .filter((o) => PARTY_TEXT[o.party])
      .map((o) => ({
        party: o.party,
        title: PARTY_TEXT[o.party].title,
        hint: PARTY_TEXT[o.party].hint,
        suggested: b.aiParty === o.party,
      }));
  });

  protected readonly aiHint = computed(() => {
    const b = this.block();
    if (!b.aiParty || !PARTY_TEXT[b.aiParty]) return null;
    const evidence = readable(safeText(b.aiEvidence ?? '')).trim();
    const who = PARTY_TEXT[b.aiParty].noun;
    return evidence
      ? `A leitura acha que estes dados são ${who}, porque o contrato diz «${evidence}». Confira.`
      : `A leitura acha que estes dados são ${who}. Confira.`;
  });

  /** O trecho real do primeiro dado, com o texto ao redor. */
  protected readonly quote = computed(() => {
    const item = this.block().items[0];
    if (!item) return null;
    const parts: QuoteParts = quoteOf(safeText(item.context), safeText(item.excerpt));
    const text = (segs: QuoteParts['before']): string =>
      segs.map((s) => (s.kind === 'text' || s.kind === 'kept' || s.kind === 'protected' ? s.text : '')).join('');
    const before = text(parts.before);
    const after = text(parts.after);
    return {
      cutBefore: before.startsWith('…'),
      before: before.replace(/^…/, ''),
      hit: parts.hit,
      after: after.replace(/…$/, ''),
      cutAfter: after.endsWith('…'),
    };
  });

  /** A parte cujo campo a lista mostra: a escolhida, ou a que o contrato deu. */
  private readonly shownParty = computed<Party | null>(() => {
    const a = this.answered();
    if (a && a !== 'NONE') return a;
    return a === 'NONE' ? null : this.block().party;
  });

  protected readonly rows = computed<ItemRow[]>(() => {
    const party = this.shownParty();
    return this.block().items.map((i) => ({
      id: i.id,
      label: KIND_LABELS[i.kind] ?? 'Dado',
      value: readable(safeText(i.excerpt)),
      field: party && party !== 'THIRD' ? (i.fieldsByParty[party]?.[0]?.field ?? null) : null,
      fieldLabel: party && party !== 'THIRD' ? (i.fieldsByParty[party]?.[0]?.label ?? null) : null,
    }));
  });

  /** Terceiro: os dados que podem virar referência do motorista (o nome). */
  protected readonly referenceItems = computed(() =>
    this.block()
      .items.filter((i: BlockItemView) => (i.fieldsByParty.THIRD ?? []).length > 0)
      .map((i) => ({
        id: i.id,
        value: readable(safeText(i.excerpt)),
        fields: (i.fieldsByParty.THIRD ?? []).map((f) => ({
          field: f.field,
          short: shortReference(f.field, f.label),
        })),
      })),
  );

  protected readonly reachText = computed(() => {
    const n = this.block().appliesTo || this.block().items.length;
    return n === 1 ? '1 item' : `${n} itens`;
  });

  protected fieldName(row: ItemRow): string {
    return safeText(row.fieldLabel ?? '') || fieldLabel(row.field ?? '');
  }

  protected answer(party: BlockAnswer): void {
    this.fixing.set(this.isConfirm() && party !== this.block().party);
    this.answer$.emit(party);
  }

  /** Status só no chip: texto no fundo tingido. */
  protected chipClass(field: string | null): string {
    const tone = field
      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
      : 'bg-surface-strong text-fg-soft';
    return `inline-flex items-center rounded-full px-2 py-0.5 text-[13px] font-semibold ${tone}`;
  }

  protected cardClass(on: boolean): string {
    const base =
      'press flex min-h-[60px] w-full items-center gap-3.5 rounded-2xl border-2 px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2';
    return `${base} ${on ? 'border-primary-500 bg-surface shadow-sm' : 'border-edge bg-surface hover:border-neutral-400 dark:hover:border-neutral-500'}`;
  }

  protected dotClass(on: boolean): string {
    const base = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors';
    return `${base} ${on ? 'border-primary-500 bg-primary-500' : 'border-neutral-400 dark:border-neutral-500 bg-surface'}`;
  }
}

/** «Referência 1 do motorista» → «Referência 1». */
function shortReference(field: string, label: string): string {
  const n = /(\d)$/.exec(field)?.[1];
  return n ? `Referência ${n}` : safeText(label);
}
