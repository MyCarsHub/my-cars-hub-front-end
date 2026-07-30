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

  const press = (key: string): void => {
    host
      .querySelector('[role="radiogroup"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    fixture.detectChanges();
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

  it('keeps only the selected chip tabbable (roving tabindex)', () => {
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

  it('moves selection and focus with arrow keys, wrapping at both ends', () => {
    press('ArrowRight');
    expect(fixture.componentInstance.emitted).toEqual(['b']);
    expect(document.activeElement).toBe(chips()[1]);

    press('ArrowLeft');
    press('ArrowLeft');
    expect(fixture.componentInstance.emitted).toEqual(['b', 'a', 'c']);
    expect(document.activeElement).toBe(chips()[2]);

    press('ArrowRight');
    expect(fixture.componentInstance.emitted.at(-1)).toBe('a');
  });

  it('jumps to the extremes with Home and End', () => {
    press('End');
    expect(fixture.componentInstance.emitted.at(-1)).toBe('c');
    press('Home');
    expect(fixture.componentInstance.emitted.at(-1)).toBe('a');
  });

  it('ignores keys that are not navigation keys', () => {
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
