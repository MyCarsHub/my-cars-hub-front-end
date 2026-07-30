import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FilterChipGroup, FilterChipOption } from './filter-chip-group';

type Preset = 'a' | 'b' | 'c';

const OPTIONS: readonly FilterChipOption<Preset>[] = [
  { value: 'a', label: 'Alfa' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gama' },
];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FilterChipGroup],
  template: `
    <app-filter-chip-group
      [options]="options"
      [value]="value()"
      [scrollable]="scrollable()"
      ariaLabel="Período"
      (selectionChange)="onSelect($event)"
    />
  `,
})
class Host {
  readonly options = OPTIONS;
  readonly value = signal<Preset>('a');
  readonly scrollable = signal(false);
  readonly emitted: Preset[] = [];

  onSelect(next: Preset): void {
    this.emitted.push(next);
    this.value.set(next);
  }
}

describe('FilterChipGroup', () => {
  let fixture: ComponentFixture<Host>;
  let host: HTMLElement;

  const chips = (): HTMLButtonElement[] =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'));

  /** Dispara o keydown a partir do chip focado — ou do grupo, se o foco está fora. */
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

  it('renders a radiogroup with one radio per option', () => {
    const group = host.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('Período');
    expect(chips().map((c) => c.textContent?.trim())).toEqual(['Alfa', 'Beta', 'Gama']);
  });

  it('marks only the selected chip as checked and styles it as active', () => {
    expect(chips().map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(chips()[0].className).toContain('bg-primary-500');
    expect(chips()[1].className).toContain('bg-white');
  });

  it('gives every chip the 44px touch target and a visible focus ring', () => {
    for (const chip of chips()) {
      expect(chip.className).toContain('min-h-[44px]');
      expect(chip.className).toContain('focus-visible:ring-2');
    }
  });

  it('keeps the selected chip tabbable while focus is outside the group', () => {
    expect(chips().map((c) => c.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);

    fixture.componentInstance.value.set('c');
    fixture.detectChanges();
    expect(chips().map((c) => c.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });

  it('falls back to the first chip when the value matches no option', () => {
    fixture.componentInstance.value.set('z' as Preset);
    fixture.detectChanges();
    expect(chips().map((c) => c.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
    ]);
    expect(chips()[0].getAttribute('tabindex')).toBe('0');
  });

  it('emits the option value on click', () => {
    chips()[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.emitted).toEqual(['b']);
    expect(chips()[1].getAttribute('aria-checked')).toBe('true');
  });

  it('moves focus with arrow keys WITHOUT emitting a selection, wrapping at both ends', () => {
    press('ArrowRight');
    expect(document.activeElement).toBe(chips()[1]);

    press('ArrowLeft');
    press('ArrowLeft');
    expect(document.activeElement).toBe(chips()[2]);

    press('ArrowRight');
    expect(document.activeElement).toBe(chips()[0]);

    expect(fixture.componentInstance.emitted).toEqual([]);
    expect(chips().map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('moves focus with Home and End without emitting a selection', () => {
    press('End');
    expect(document.activeElement).toBe(chips()[2]);
    press('Home');
    expect(document.activeElement).toBe(chips()[0]);
    expect(fixture.componentInstance.emitted).toEqual([]);
  });

  it('accepts ArrowDown and ArrowUp as focus movers too', () => {
    press('ArrowDown');
    expect(document.activeElement).toBe(chips()[1]);
    press('ArrowUp');
    expect(document.activeElement).toBe(chips()[0]);
    expect(fixture.componentInstance.emitted).toEqual([]);
  });

  it('confirms the focused chip with Enter', () => {
    press('ArrowRight');
    press('ArrowRight');
    expect(fixture.componentInstance.emitted).toEqual([]);

    press('Enter');
    expect(fixture.componentInstance.emitted).toEqual(['c']);
    expect(chips()[2].getAttribute('aria-checked')).toBe('true');
  });

  it('confirms the focused chip with Space', () => {
    press('ArrowRight');
    press(' ');
    expect(fixture.componentInstance.emitted).toEqual(['b']);
    expect(chips()[1].getAttribute('aria-checked')).toBe('true');
  });

  it('cancels the native button activation so Enter and Space emit only once', () => {
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(press(' ').defaultPrevented).toBe(true);
    expect(fixture.componentInstance.emitted).toEqual(['a', 'a']);
  });

  it('moves the roving tabindex to the focused chip and gives it back on focus out', () => {
    expect(chips().map((c) => c.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);

    press('ArrowRight');
    expect(chips().map((c) => c.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(chips().map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);

    chips()[1].blur();
    fixture.detectChanges();
    expect(chips().map((c) => c.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('ignores keys that are not navigation or confirmation keys', () => {
    press('Tab');
    press('a');
    expect(fixture.componentInstance.emitted).toEqual([]);
  });

  it('switches the container to a snap carousel when scrollable', () => {
    expect(host.querySelector('[role="radiogroup"]')?.className).toContain('flex-wrap');

    fixture.componentInstance.scrollable.set(true);
    fixture.detectChanges();
    expect(host.querySelector('[role="radiogroup"]')?.className).toContain('snap-x');
    expect(chips()[0].className).toContain('snap-start');
  });
});
