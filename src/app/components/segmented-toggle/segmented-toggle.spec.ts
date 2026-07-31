import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SegmentedToggle, SegmentedToggleOption } from './segmented-toggle';

type Cycle = 'monthly' | 'yearly';

const MONTHLY_BG = 'linear-gradient(135deg, #FA602E 0%, #F63B04 55%, #C22F00 100%)';
const YEARLY_BG = 'linear-gradient(135deg, #34D399 0%, #10B981 55%, #059669 100%)';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SegmentedToggle],
  template: `
    <app-segmented-toggle
      [options]="options()"
      [value]="value()"
      [textClass]="textClass()"
      ariaLabel="Ciclo de cobrança"
      (selectionChange)="onSelect($event)"
    />
  `,
})
class Host {
  readonly badge = signal('-17%');
  readonly textClass = signal('text-sm');
  readonly value = signal<Cycle>('monthly');
  readonly emitted: Cycle[] = [];

  readonly options = signal<readonly SegmentedToggleOption<Cycle>[]>([]);

  constructor() {
    this.syncOptions();
  }

  syncOptions(): void {
    const badge = this.badge();
    this.options.set([
      {
        value: 'monthly',
        label: 'Mensal',
        activeBackground: MONTHLY_BG,
        activeShadow: '0 1px 2px red',
      },
      {
        value: 'yearly',
        label: 'Anual',
        badge: badge.length > 0 ? badge : undefined,
        activeBackground: YEARLY_BG,
      },
    ]);
  }

  onSelect(next: Cycle): void {
    this.emitted.push(next);
    this.value.set(next);
  }
}

/** Host de um consumidor com pill claro (o seletor de ordenação do Roadmap). */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SegmentedToggle],
  template: `
    <app-segmented-toggle
      [options]="options"
      [value]="'monthly'"
      activeClass="text-neutral-900"
      ariaLabel="Ordenação"
    />
  `,
})
class LightActiveHost {
  readonly options: readonly SegmentedToggleOption<Cycle>[] = [
    { value: 'monthly', label: 'Mensal', activeBackground: '#ffffff' },
    { value: 'yearly', label: 'Anual' },
  ];
}

describe('SegmentedToggle', () => {
  let fixture: ComponentFixture<Host>;
  let host: HTMLElement;

  const segments = (): HTMLButtonElement[] =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'));

  const press = (key: string): KeyboardEvent => {
    const active = document.activeElement;
    const from =
      active && host.contains(active) ? active : host.querySelector('[role="radiogroup"]');
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    from?.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  // ---------------------------------------------------------------------------
  // Semântica: seleção única que troca DADO na tela — radiogroup, nunca tablist
  // ---------------------------------------------------------------------------

  it('renders a radiogroup with one radio per option and no tab semantics', () => {
    const group = host.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('Ciclo de cobrança');
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector('[role="tab"]')).toBeNull();
    expect(segments().map((s) => s.textContent?.trim().replace(/\s+/g, ' '))).toEqual([
      'Mensal',
      'Anual -17%',
    ]);
  });

  it('marks only the selected option as checked', () => {
    expect(segments().map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false']);

    fixture.componentInstance.value.set('yearly');
    fixture.detectChanges();
    expect(segments().map((s) => s.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  });

  // ---------------------------------------------------------------------------
  // Acento por opção — o gradiente vem de quem usa, não do componente
  // ---------------------------------------------------------------------------

  it('paints only the selected option with the accent supplied by the consumer', () => {
    expect(segments()[0].style.background).toContain('linear-gradient');
    expect(segments()[0].style.boxShadow).toBe('0 1px 2px red');
    expect(segments()[1].style.background).toBe('transparent');
    expect(segments()[1].style.boxShadow).toBe('none');

    fixture.componentInstance.value.set('yearly');
    fixture.detectChanges();
    expect(segments()[0].style.background).toBe('transparent');
    expect(segments()[1].style.background).toContain('linear-gradient');
    // A opção sem `activeShadow` fica sem sombra mesmo selecionada.
    expect(segments()[1].style.boxShadow).toBe('none');
  });

  it('swaps the text colour between active and inactive options', () => {
    expect(segments()[0].className).toContain('text-white');
    expect(segments()[1].className).toContain('text-neutral-500');
  });

  it('lets the consumer override the active text colour for a light pill', () => {
    const light = TestBed.createComponent(LightActiveHost);
    light.detectChanges();
    const active = (light.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[aria-checked="true"]',
    );
    expect(active?.className).toContain('text-neutral-900');
    expect(active?.className).not.toContain('text-white');
  });

  it('replaces the font size instead of stacking two text-* classes', () => {
    fixture.componentInstance.textClass.set('text-[13.5px]');
    fixture.detectChanges();
    expect(segments()[0].className).toContain('text-[13.5px]');
    expect(segments()[0].className).not.toContain('text-sm');
  });

  // ---------------------------------------------------------------------------
  // Badge
  // ---------------------------------------------------------------------------

  it('renders the badge only on the option that carries one', () => {
    const badges = host.querySelectorAll('[role="radio"] span');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent?.trim()).toBe('-17%');
    expect(segments()[1].contains(badges[0])).toBe(true);
  });

  it('restyles the badge when its option becomes selected', () => {
    const badge = (): Element | null => host.querySelector('[role="radio"] span');
    expect(badge()?.className).toContain('bg-emerald-600');

    fixture.componentInstance.value.set('yearly');
    fixture.detectChanges();
    expect(badge()?.className).toContain('bg-white/25');
  });

  it('drops the badge when the consumer omits it', () => {
    fixture.componentInstance.badge.set('');
    fixture.componentInstance.syncOptions();
    fixture.detectChanges();
    expect(host.querySelectorAll('[role="radio"] span').length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Alvo de toque + foco visível
  // ---------------------------------------------------------------------------

  it('gives every option the 44px touch target and a visible focus outline', () => {
    for (const segment of segments()) {
      expect(segment.className).toContain('min-h-[44px]');
      expect(segment.className).toContain('focus-visible:outline-2');
      expect(segment.className).toContain('focus-visible:outline-primary-500');
      // `ring` vira box-shadow e o `[style.box-shadow]` inline o sobrescreve;
      // `outline-none` zeraria a var que o `outline-2` usa. Nenhum dos dois pode voltar.
      expect(segment.className).not.toContain('ring-');
      expect(segment.className).not.toContain('outline-none');
    }
  });

  // ---------------------------------------------------------------------------
  // Roving tabindex + teclado (seta move foco, Enter/Espaço confirma)
  // ---------------------------------------------------------------------------

  it('keeps the selected option tabbable while focus is outside the group', () => {
    expect(segments().map((s) => s.getAttribute('tabindex'))).toEqual(['0', '-1']);

    fixture.componentInstance.value.set('yearly');
    fixture.detectChanges();
    expect(segments().map((s) => s.getAttribute('tabindex'))).toEqual(['-1', '0']);
  });

  it('falls back to the first option when the value matches none', () => {
    fixture.componentInstance.value.set('quarterly' as Cycle);
    fixture.detectChanges();
    expect(segments().map((s) => s.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect(segments()[0].getAttribute('tabindex')).toBe('0');
  });

  it('emits the option value on click', () => {
    segments()[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.emitted).toEqual(['yearly']);
  });

  it('moves focus with arrows WITHOUT emitting, wrapping at both ends', () => {
    press('ArrowRight');
    expect(document.activeElement).toBe(segments()[1]);

    press('ArrowRight');
    expect(document.activeElement).toBe(segments()[0]);

    press('ArrowLeft');
    expect(document.activeElement).toBe(segments()[1]);

    expect(fixture.componentInstance.emitted).toEqual([]);
    expect(segments().map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  });

  it('accepts ArrowDown/ArrowUp and Home/End as focus movers only', () => {
    press('ArrowDown');
    expect(document.activeElement).toBe(segments()[1]);
    press('ArrowUp');
    expect(document.activeElement).toBe(segments()[0]);
    press('End');
    expect(document.activeElement).toBe(segments()[1]);
    press('Home');
    expect(document.activeElement).toBe(segments()[0]);
    expect(fixture.componentInstance.emitted).toEqual([]);
  });

  it('confirms the focused option with Enter and with Space', () => {
    press('ArrowRight');
    expect(fixture.componentInstance.emitted).toEqual([]);

    press('Enter');
    expect(fixture.componentInstance.emitted).toEqual(['yearly']);

    press('ArrowLeft');
    press(' ');
    expect(fixture.componentInstance.emitted).toEqual(['yearly', 'monthly']);
  });

  it('cancels the native button activation so Enter and Space emit only once', () => {
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(press(' ').defaultPrevented).toBe(true);
    expect(fixture.componentInstance.emitted).toEqual(['monthly', 'monthly']);
  });

  it('moves the roving tabindex to the focused option and gives it back on focus out', () => {
    press('ArrowRight');
    expect(segments().map((s) => s.getAttribute('tabindex'))).toEqual(['-1', '0']);
    expect(segments().map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false']);

    segments()[1].blur();
    fixture.detectChanges();
    expect(segments().map((s) => s.getAttribute('tabindex'))).toEqual(['0', '-1']);
  });

  it('ignores keys that are neither navigation nor confirmation', () => {
    expect(press('Tab').defaultPrevented).toBe(false);
    press('a');
    expect(fixture.componentInstance.emitted).toEqual([]);
  });
});
