import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';

let nextId = 0;

export interface SearchSelectOption {
  readonly id: string;
  /** Linha principal (nome do motorista, placa do carro). */
  readonly title: string;
  /** Segunda linha (modelo do carro). Também entra na busca. */
  readonly subtitle?: string;
  /** Iniciais do avatar laranja. Ausente = sem avatar. */
  readonly initials?: string;
  /** Ocupado: aparece apagado, com o motivo, e não pode ser escolhido. */
  readonly busy?: boolean;
  /** O motivo DESTE item ocupado (ex.: "Em aluguel até 30/11"); ausente = o `busyText` da lista. */
  readonly busyReason?: string | null;
}

/** Sem acento e em minúsculas: "joão" acha "Joao". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Lista com busca (combobox): o campo fechado mostra a escolha; aberto, um painel com a caixa
 * de busca e as opções.
 *
 * - Ocupados aparecem apagados com o motivo (`busyText`), nunca somem; não há linha "criar".
 * - Celular: o painel abre no fluxo, embaixo do campo. Computador (≥ 1024px): flutua por cima
 *   do resto da página.
 * - ARIA: o campo é um botão com `aria-haspopup="listbox"`; a caixa de busca é o
 *   `role="combobox"` (`aria-controls` + `aria-activedescendant`) da lista `role="listbox"`.
 *   Setas movem a opção ativa (pulando as ocupadas), Enter escolhe, Esc fecha e devolve o foco
 *   ao campo, Tab ou um toque fora fecham.
 */
@Component({
  selector: 'app-search-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './search-select.html',
  styleUrl: './search-select.css',
  host: {
    '(document:pointerdown)': 'onOutside($event)',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class SearchSelect {
  readonly label = input.required<string>();
  readonly required = input(false);
  readonly placeholder = input('Selecione');
  readonly searchPlaceholder = input('Buscar');
  readonly options = input<readonly SearchSelectOption[]>([]);
  /** Id escolhido ('' = nenhum). */
  readonly value = model('');
  readonly error = input<string | null>(null);
  readonly busyText = input('Com outro aluguel nessas datas');
  /** "1 veículo encontrado" / "3 veículos encontrados". */
  readonly foundWords = input<readonly [string, string]>(['encontrado', 'encontrados']);
  readonly emptyText = input('Nada encontrado.');
  readonly testId = input('');
  /** O painel fechou (o chamador marca o campo como visitado). */
  readonly closed = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly id = `ss-${++nextId}`;
  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly active = signal(-1);

  protected readonly selected = computed(
    () => this.options().find((o) => o.id === this.value()) ?? null,
  );

  protected readonly filtered = computed(() => {
    const q = fold(this.query().trim());
    const all = this.options();
    if (!q) return all;
    return all.filter((o) => fold(`${o.title} ${o.subtitle ?? ''}`).includes(q));
  });

  protected readonly countText = computed(() => {
    const n = this.filtered().length;
    const [one, many] = this.foundWords();
    return `${n} ${n === 1 ? one : many}`;
  });

  protected readonly activeId = computed(() =>
    this.open() && this.active() >= 0 && this.active() < this.filtered().length
      ? this.optionId(this.active())
      : null,
  );

  protected optionId(i: number): string {
    return `${this.id}-o${i}`;
  }

  // ------------------------------------------------------------------ abrir e fechar
  protected toggle(): void {
    if (this.open()) this.close(true);
    else this.show();
  }

  private show(): void {
    this.query.set('');
    const list = this.filtered();
    const sel = list.findIndex((o) => o.id === this.value());
    this.active.set(sel >= 0 ? sel : this.step(-1, 1));
    this.open.set(true);
    afterNextRender(
      () => {
        this.host.nativeElement.querySelector<HTMLInputElement>('.ss-q')?.focus();
        this.revealActive();
      },
      { injector: this.injector },
    );
  }

  /** Fecha o painel; `returnFocus` devolve o foco ao campo (Esc, escolha). */
  close(returnFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    this.closed.emit();
    if (returnFocus) {
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.ss-f')?.focus(), {
        injector: this.injector,
      });
    }
  }

  protected onOutside(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node | null)) {
      this.close(false);
    }
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (this.open() && next && !this.host.nativeElement.contains(next)) this.close(false);
  }

  // ------------------------------------------------------------------ teclado e escolha
  protected onTriggerKey(event: KeyboardEvent): void {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !this.open()) {
      event.preventDefault();
      this.show();
    }
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.active.set(this.step(-1, 1));
  }

  protected onSearchKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.active.set(this.step(this.active(), 1));
        this.revealActive();
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.active.set(this.step(this.active(), -1));
        this.revealActive();
        return;
      case 'Enter': {
        event.preventDefault();
        const option = this.filtered()[this.active()];
        if (option) this.pick(option);
        return;
      }
      case 'Escape':
        event.preventDefault();
        this.close(true);
        return;
    }
  }

  protected pick(option: SearchSelectOption): void {
    if (option.busy) return;
    this.value.set(option.id);
    this.close(true);
  }

  protected hover(i: number): void {
    if (!this.filtered()[i]?.busy) this.active.set(i);
  }

  /** Próxima opção livre a partir de `from`, na direção `dir`; fica onde está se não há. */
  private step(from: number, dir: 1 | -1): number {
    const list = this.filtered();
    for (let i = from + dir; i >= 0 && i < list.length; i += dir) {
      if (!list[i].busy) return i;
    }
    return from >= 0 && from < list.length ? from : -1;
  }

  private revealActive(): void {
    const id = this.activeId();
    if (!id) return;
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView?.({ block: 'nearest' }),
      { injector: this.injector },
    );
  }
}
