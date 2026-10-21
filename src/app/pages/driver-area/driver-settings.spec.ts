import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorService } from '../../services/api-error.service';
import {
  DEFAULT_DRIVER_PREFS,
  DriverNotificationPrefs,
  DriverPreferencesService,
} from '../../services/driver-preferences.service';
import { NotificationService } from '../../services/notification.service';
import { DriverSettings } from './driver-settings';

describe('DriverSettings', () => {
  let fixture: ComponentFixture<DriverSettings>;
  let get: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let notifications: NotificationService;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const sw = (key: string) => root().querySelector<HTMLButtonElement>(`[data-pref="${key}"]`)!;
  const lead = (days: number) => root().querySelector<HTMLButtonElement>(`[data-lead="${days}"]`)!;

  function build(
    loader: () => Observable<DriverNotificationPrefs> = () => of({ ...DEFAULT_DRIVER_PREFS }),
    saver: (p: DriverNotificationPrefs) => Observable<DriverNotificationPrefs> = (p) => of(p),
  ): void {
    get = vi.fn(loader);
    update = vi.fn(saver);
    TestBed.configureTestingModule({
      providers: [ApiErrorService, { provide: DriverPreferencesService, useValue: { get, update } }],
    });
    notifications = TestBed.inject(NotificationService);
    fixture = TestBed.createComponent(DriverSettings);
    fixture.detectChanges();
  }

  describe('leitura', () => {
    beforeEach(() => build());

    it('mostra os cinco avisos do protótipo com os padrões dele', () => {
      expect(root().querySelectorAll('[role="switch"]').length).toBe(5);
      expect(sw('chargeDueSoon').getAttribute('aria-checked')).toBe('true');
      expect(sw('chargeOverdue').getAttribute('aria-checked')).toBe('true');
      expect(sw('inspectionRequested').getAttribute('aria-checked')).toBe('true');
      expect(sw('inspectionResult').getAttribute('aria-checked')).toBe('true');
      expect(sw('newFine').getAttribute('aria-checked')).toBe('false');
      expect(lead(1).getAttribute('aria-checked')).toBe('true');
    });

    it('cada switch tem nome acessível e alvo de 44px', () => {
      const button = sw('chargeOverdue');
      const label = root().querySelector(`#${button.getAttribute('aria-labelledby')}`);
      expect(label?.textContent).toContain('Cobrança atrasada');
      expect(button.className).toContain('h-11');
    });

    it('não oferece conexão de apps (Uber/99 fora do escopo) nem meta', () => {
      const t = text().toLowerCase();
      for (const word of ['uber', '99', 'conectar', 'meta']) {
        expect(t, `apareceu "${word}"`).not.toContain(word);
      }
    });
  });

  describe('gravação', () => {
    it('ligar um aviso grava o objeto inteiro e confirma', () => {
      build();
      const success = vi.spyOn(notifications, 'success');
      sw('newFine').click();
      fixture.detectChanges();

      expect(update).toHaveBeenCalledWith({ ...DEFAULT_DRIVER_PREFS, newFine: true });
      expect(sw('newFine').getAttribute('aria-checked')).toBe('true');
      expect(success).toHaveBeenCalledWith('Aviso ligado.');
    });

    it('escolher a antecedência grava e marca a opção', () => {
      build();
      lead(3).click();
      fixture.detectChanges();

      expect(update).toHaveBeenCalledWith({ ...DEFAULT_DRIVER_PREFS, chargeLeadDays: 3 });
      expect(lead(3).getAttribute('aria-checked')).toBe('true');
      expect(lead(3).getAttribute('tabindex')).toBe('0');
      expect(lead(1).getAttribute('tabindex')).toBe('-1');
    });

    it('tocar na opção já marcada não grava de novo', () => {
      build();
      lead(1).click();
      expect(update).not.toHaveBeenCalled();
    });

    it('se a gravação falhar, o switch volta ao que era e um toast avisa', () => {
      build(undefined, () => throwError(() => new HttpErrorResponse({ status: 500 })));
      const error = vi.spyOn(notifications, 'error');
      sw('chargeOverdue').click();
      fixture.detectChanges();

      expect(sw('chargeOverdue').getAttribute('aria-checked')).toBe('true');
      expect(error).toHaveBeenCalled();
    });

    it('setas movem o foco no grupo de antecedência, circulando', () => {
      build();
      lead(1).focus();
      lead(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      expect(document.activeElement).toBe(lead(3));
    });
  });

  describe('carga', () => {
    it('enquanto carrega mostra o skeleton e nenhum switch', () => {
      build(() => new Subject<DriverNotificationPrefs>());
      expect(root().querySelector('[data-skeleton]')?.getAttribute('aria-busy')).toBe('true');
      expect(root().querySelector('[role="switch"]')).toBeNull();
    });

    it('se falhar, mostra o erro e tenta de novo pelo botão', () => {
      let calls = 0;
      build(() => {
        calls++;
        return calls === 1
          ? throwError(() => new HttpErrorResponse({ status: 503 }))
          : of({ ...DEFAULT_DRIVER_PREFS });
      });
      expect(root().querySelector('[data-load-error]')).not.toBeNull();

      root().querySelector<HTMLButtonElement>('[data-load-error] button')!.click();
      fixture.detectChanges();
      expect(get).toHaveBeenCalledTimes(2);
      expect(root().querySelectorAll('[role="switch"]').length).toBe(5);
    });
  });
});
