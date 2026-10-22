import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { FIELD_LABELS } from './ai/contract-ai.messages';
import { PaperParagraph, PaperSegment } from './contract-paper.model';
import { fieldCode, fieldExample } from './contract-fields';
import { ContractIcon, ContractIconName } from './contract-icon';

export type PaperMode = 'example' | 'names';

/**
 * O contrato ao vivo da esteira: a «mesa» (fundo pontilhado) com uma folha de papel por
 * cima, que tem rolagem própria. Só desenha o que `contract-paper.model.ts` montou; não há
 * HTML vindo de fora (tudo é interpolação). A legenda das cores sai do próprio documento:
 * só aparece a cor que está na folha.
 */
@Component({
  selector: 'app-contract-paper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex min-w-0 flex-col gap-3 bg-neutral-100 px-3 py-4 sm:gap-4 sm:p-6',
  },
  imports: [ContractIcon],
  styles: `
    /* A mesa: pontos discretos atrás da folha. */
    :host {
      background-image: radial-gradient(#d4d4d4 1px, transparent 1px);
      background-size: 20px 20px;
    }
    /* Fonte de documento com algarismos alinhados (a Georgia só tem os de estilo antigo,
       que fazem «R$ 700,00» e datas dançarem na linha). */
    .doc-serif {
      font-family: Cambria, 'Times New Roman', 'Noto Serif', serif;
    }
    @keyframes paper-in {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .paper-in { animation: paper-in 280ms var(--ease-out) both; }
    }
  `,
  template: `
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <span class="flex min-w-0 items-center gap-2">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-neutral-700 shadow-sm ring-1 ring-black/5">
          <app-contract-icon name="fileText" [size]="16" />
        </span>
        <span class="text-[15px] font-semibold text-neutral-800">{{ title() }}</span>
      </span>
      @if (showModeSwitch()) {
        <div
          role="radiogroup"
          aria-label="Mostrar no contrato"
          class="flex w-full gap-1 rounded-xl bg-neutral-200 p-1 sm:w-auto"
        >
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="mode() === 'example'"
            (click)="modeChange.emit('example')"
            class="min-h-[44px] flex-auto rounded-lg px-2.5 text-base leading-tight sm:whitespace-nowrap font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 sm:flex-none sm:px-3"
            [class]="mode() === 'example' ? onClass : offClass"
          >
            Com exemplo
          </button>
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="mode() === 'names'"
            (click)="modeChange.emit('names')"
            class="min-h-[44px] flex-auto rounded-lg px-2.5 text-base leading-tight sm:whitespace-nowrap font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 sm:flex-none sm:px-3"
            [class]="mode() === 'names' ? onClass : offClass"
          >
            Com o nome dos campos
          </button>
        </div>
      }
    </div>

    @if (draft() || legend().length > 0) {
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        @if (draft()) {
          <p
            class="m-0 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[13px] font-semibold text-amber-900"
          >
            <app-contract-icon name="pen" [size]="14" />
            Rascunho, aguardando revisão jurídica
          </p>
        }
        @if (legend().length > 0 && !loading()) {
          <ul class="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0" aria-label="Legenda das cores">
            @for (l of legend(); track l.key) {
              <li class="flex items-center gap-1.5 text-base font-medium text-neutral-700">
                <span aria-hidden="true" class="h-4 w-4 rounded-[4px]" [class]="l.swatch"></span>
                {{ l.label }}
              </li>
            }
          </ul>
        }
      </div>
    }

    @if (loading()) {
      <div
        aria-hidden="true"
        class="mx-auto box-border flex w-full max-w-[760px] flex-1 flex-col gap-3 rounded-[3px] bg-white px-5 py-8 shadow-lg sm:px-12 sm:py-12"
        [class]="split() ? 'min-h-[520px]' : 'min-h-[320px]'"
      >
        <div class="mx-auto mb-3 h-4 w-3/5 rounded bg-neutral-200 motion-safe:animate-pulse"></div>
        @for (w of skeleton; track $index) {
          <div class="h-3 rounded bg-neutral-100 motion-safe:animate-pulse" [style.width]="w"></div>
        }
      </div>
    } @else if (paragraphs().length === 0) {
      <div
        class="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-8 text-center"
        [class]="split() ? 'min-h-[480px]' : 'min-h-[240px]'"
      >
        <!-- Folha fantasma: mostra o que vai aparecer aqui (texto + campos coloridos). -->
        <div aria-hidden="true" class="relative">
          <div class="absolute inset-0 translate-x-2.5 translate-y-2 rotate-[4deg] rounded-[3px] bg-white shadow-sm ring-1 ring-black/5"></div>
          <div class="relative flex w-40 flex-col gap-2 rounded-[3px] bg-white px-4 py-5 shadow-md ring-1 ring-black/5 sm:w-48">
            <div class="mx-auto mb-1 h-2 w-2/3 rounded bg-neutral-300"></div>
            <div class="flex gap-1.5"><span class="h-1.5 w-8 rounded bg-neutral-200"></span><span class="h-1.5 w-12 rounded bg-emerald-300"></span><span class="h-1.5 flex-1 rounded bg-neutral-200"></span></div>
            <div class="h-1.5 w-full rounded bg-neutral-200"></div>
            <div class="flex gap-1.5"><span class="h-1.5 flex-1 rounded bg-neutral-200"></span><span class="h-1.5 w-10 rounded bg-amber-300"></span></div>
            <div class="h-1.5 w-4/5 rounded bg-neutral-200"></div>
            <div class="flex gap-1.5"><span class="h-1.5 w-14 rounded bg-emerald-300"></span><span class="h-1.5 flex-1 rounded bg-neutral-200"></span></div>
            <div class="h-1.5 w-3/5 rounded bg-neutral-200"></div>
          </div>
          <span class="absolute -bottom-3 -right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-primary-700 shadow-md ring-1 ring-black/5">
            <app-contract-icon [name]="emptyIcon()" [size]="20" />
          </span>
        </div>
        <p class="m-0 max-w-[34ch] text-[15px] leading-relaxed text-neutral-700">{{ emptyText() }}</p>
      </div>
    } @else {
      <div class="relative mx-auto flex w-full max-w-[760px] flex-1 flex-col">
        <!-- A segunda folha atrás dá a ideia de documento de várias páginas. -->
        <div aria-hidden="true" class="absolute inset-x-3 -bottom-1.5 top-3 hidden rounded-[3px] bg-white shadow-sm ring-1 ring-black/5 sm:block"></div>
        <article
          [attr.aria-label]="title()"
          tabindex="0"
          class="paper-in relative box-border flex w-full flex-1 flex-col gap-4 overflow-y-auto overscroll-contain rounded-[3px] bg-white px-5 py-7 shadow-lg ring-1 ring-black/5 sm:px-12 sm:py-11 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          [class]="split() ? 'max-h-[720px]' : 'max-h-[60vh]'"
        >
          @for (p of paragraphs(); track p.id) {
            <p
              class="m-0 rounded-md doc-serif leading-[1.75] text-neutral-800 break-words transition-colors duration-300"
              [class]="paragraphClass(p)"
              [attr.data-focus]="p.focus ? 'true' : null"
            ><!-- Uma linha só: espaço entre os spans viraria espaço no texto do contrato. -->@for (s of p.segments; track $index) {<span [class]="segmentClass(s)" [attr.title]="segmentTitle(s)" [attr.data-focus]="isFocused(s) ? 'true' : null">{{ segmentText(s) }}</span>}</p>
          }
        </article>
      </div>
    }
  `,
})
export class ContractPaper {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly title = input('Contrato');
  readonly paragraphs = input<readonly PaperParagraph[]>([]);
  readonly mode = input<PaperMode>('example');
  readonly showModeSwitch = input(false);
  readonly emptyText = input('');
  readonly loading = input(false);
  readonly draft = input(false);
  /** Ao lado da etapa (rolagem até 720px) ou abaixo dela (até 60vh). */
  readonly split = input(false);
  readonly modeChange = output<PaperMode>();

  protected readonly onClass = 'bg-white text-neutral-900 shadow-sm';
  protected readonly offClass = 'bg-transparent text-neutral-700 hover:text-neutral-900';
  protected readonly skeleton = ['100%', '92%', '96%', '70%', '100%', '88%', '94%', '60%', '100%', '84%'];

  /** Ícone do selo da folha vazia: o envio quando o título fala do arquivo. */
  protected readonly emptyIcon = computed<ContractIconName>(() =>
    /seu contrato/i.test(this.title()) ? 'fileUp' : 'pen',
  );

  /** Só as cores que estão na folha agora. */
  protected readonly legend = computed(() => {
    let ok = false;
    let doubt = false;
    let hidden = false;
    for (const p of this.paragraphs()) {
      for (const s of p.segments) {
        if (s.kind === 'field') {
          if (s.tone === 'doubt') doubt = true;
          else ok = true;
        } else if (s.kind === 'hidden') {
          hidden = true;
        }
      }
    }
    const out: { key: string; label: string; swatch: string }[] = [];
    if (ok) out.push({ key: 'ok', label: 'Preenchido sozinho', swatch: 'border-b-2 border-emerald-500 bg-emerald-100' });
    if (doubt) out.push({ key: 'doubt', label: 'Pergunta da IA', swatch: 'border-b-2 border-amber-500 bg-amber-100' });
    if (hidden) out.push({ key: 'hidden', label: 'Escondido da IA', swatch: 'bg-neutral-200' });
    return out;
  });

  constructor() {
    // O trecho em foco (cláusula ou pergunta) rola para dentro da folha, sem mexer na página.
    afterRenderEffect(() => {
      this.paragraphs();
      const sheet = this.host.nativeElement.querySelector('article');
      const target = sheet?.querySelector<HTMLElement>('[data-focus="true"]');
      if (!sheet || !target) return;
      const top = target.offsetTop;
      const bottom = top + target.offsetHeight;
      if (top >= sheet.scrollTop + 24 && bottom <= sheet.scrollTop + sheet.clientHeight - 24) return;
      const reduce =
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const y = Math.max(0, top - sheet.clientHeight / 3);
      if (typeof sheet.scrollTo === 'function') {
        sheet.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
      }
    });
  }

  protected paragraphClass(p: PaperParagraph): string {
    const base =
      p.role === 'title'
        ? 'mb-1 text-center text-[17px] font-bold tracking-[0.01em] sm:text-lg'
        : 'text-left text-[15px] sm:text-base';
    return p.focus
      ? `${base} -mx-3 border-l-4 border-primary-500 bg-primary-50 px-3 py-1`
      : base;
  }

  protected isFocused(s: PaperSegment): boolean {
    return (s.kind === 'field' || s.kind === 'kept') && !!s.focus;
  }

  protected segmentText(s: PaperSegment): string {
    switch (s.kind) {
      case 'field':
        return this.mode() === 'names' ? fieldCode(s.field) : fieldExample(s.field);
      case 'hidden':
        return s.label;
      default:
        return s.text;
    }
  }

  protected segmentTitle(s: PaperSegment): string | null {
    return s.kind === 'field' ? (FIELD_LABELS[s.field] ?? s.field) : null;
  }

  protected segmentClass(s: PaperSegment): string {
    switch (s.kind) {
      case 'text':
        return s.bold ? 'font-bold' : '';
      case 'hidden':
        return 'rounded-[4px] bg-neutral-200 px-1 py-px font-sans text-[13px] font-medium text-neutral-700 [box-decoration-break:clone]';
      case 'kept':
        return s.focus
          ? 'rounded-[3px] bg-amber-50 outline-2 outline-offset-1 outline-amber-500 [box-decoration-break:clone]'
          : '';
      case 'field': {
        const font = this.mode() === 'names' ? 'font-mono text-[13px] font-medium' : 'font-semibold';
        const color =
          s.tone === 'doubt'
            ? 'border-b-2 border-amber-500 bg-amber-100 text-amber-900'
            : 'border-b-2 border-emerald-500 bg-emerald-100 text-emerald-900';
        const ring = s.focus
          ? `outline-2 outline-offset-2 ${s.tone === 'doubt' ? 'outline-amber-500' : 'outline-emerald-600'}`
          : '';
        return `rounded-[3px] px-0.5 [box-decoration-break:clone] ${font} ${color} ${ring}`.trim();
      }
    }
  }
}
