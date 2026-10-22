import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';

import { TermsOfUseComponent } from './terms-of-use.component';

/**
 * Dois canais de aviso, de propósito diferentes: mudança material dos termos vale para todos
 * e pode ser anunciada por e-mail OU vídeo no Instagram; suspensão de conta é aviso
 * individual e continua SÓ por e-mail. Estes testes impedem que um vire o outro.
 */
describe('TermsOfUseComponent — canais de aviso', () => {
  async function visit(lang: 'pt' | 'en'): Promise<string> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'termos-de-uso', component: TermsOfUseComponent }]),
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    const suffix = lang === 'en' ? '?lang=en' : '';
    const harness = await RouterTestingHarness.create(`/termos-de-uso${suffix}`);
    harness.detectChanges();
    return ((harness.fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  it('PT: mudança material avisada por e-mail ou vídeo no Instagram, com 30 dias', async () => {
    expect(await visit('pt')).toContain(
      'avisaremos por e-mail ou por vídeo de anúncio no Instagram da MyCarsHub com pelo menos 30 dias de antecedência',
    );
  });

  it('PT: suspensão continua avisada só por e-mail', async () => {
    const text = await visit('pt');

    expect(text).toContain('avisaremos por e-mail antes de suspender');
    expect(text).not.toContain('Instagram da MyCarsHub antes de suspender');
  });

  it('EN: mudança material avisada por e-mail ou vídeo no Instagram, com 30 dias', async () => {
    expect(await visit('en')).toContain(
      'notify you by email or by an announcement video on the MyCarsHub Instagram at least 30 days in advance',
    );
  });

  it('EN: suspensão continua avisada só por e-mail', async () => {
    const text = await visit('en');

    expect(text).toContain('we will notify you by email before suspending');
    expect(text).not.toContain('Instagram before suspending');
  });

  it('data de última atualização reflete a revisão', async () => {
    expect(await visit('pt')).toContain('Última atualização: 2026-10-22');
  });
});
