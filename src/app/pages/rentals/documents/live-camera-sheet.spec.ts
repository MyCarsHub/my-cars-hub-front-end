import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { LiveCameraSheet } from './live-camera-sheet';

/** Track que sabe dizer se `stop()` foi chamado — e o que o node exige provar. */
function fakeTrack() {
  return { stop: vi.fn(), kind: 'video' as const };
}

function fakeStream(tracks: ReturnType<typeof fakeTrack>[]) {
  return { getTracks: () => tracks } as unknown as MediaStream;
}

@Component({
  imports: [LiveCameraSheet],
  template: `
    @if (aberta()) {
      <app-live-camera-sheet
        label="Frente"
        (captured)="capturado.set($event)"
        (cancelled)="cancelado.set(true)"
      />
    }
  `,
})
class Host {
  readonly aberta = signal(true);
  readonly capturado = signal<File | null>(null);
  readonly cancelado = signal(false);
}

describe('LiveCameraSheet', () => {
  let tracks: ReturnType<typeof fakeTrack>[];
  let getUserMedia: ReturnType<typeof vi.fn>;
  const originalMediaDevices = navigator.mediaDevices;

  function setMediaDevices(value: unknown): void {
    Object.defineProperty(navigator, 'mediaDevices', {
      value,
      configurable: true,
      writable: true,
    });
  }

  beforeEach(() => {
    tracks = [fakeTrack(), fakeTrack()];
    getUserMedia = vi.fn().mockResolvedValue(fakeStream(tracks));
    setMediaDevices({ getUserMedia });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [Host] });
  });

  afterEach(() => {
    setMediaDevices(originalMediaDevices);
  });

  /**
   * A camera arranca num microtask (para o `viewChild` do video ja existir), e
   * `getUserMedia` e assincrono: sao dois saltos de fila antes de o estado
   * final aparecer. Um `whenStable` so resolve cedo demais e o teste leria
   * "Abrindo a camera...".
   */
  async function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('pede a camera TRASEIRA, sem audio', async () => {
    await render();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toEqual({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  });

  it('mostra o disparo quando a camera esta viva', async () => {
    const fixture = await render();
    const disparo = (fixture.nativeElement as HTMLElement).querySelector('button[aria-label^="Tirar foto"]');

    expect(disparo).not.toBeNull();
    expect((disparo as HTMLButtonElement).disabled).toBe(false);
  });

  /**
   * O ponto do node: NAO cair no seletor de arquivo. Se a camera falhar, o
   * caminho e liberar e tentar de novo — nunca a galeria, senao bastaria negar
   * uma vez para reabrir o caminho que a regra existe para fechar.
   */
  describe('permissao negada', () => {
    beforeEach(() => {
      getUserMedia = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
      setMediaDevices({ getUserMedia });
    });

    it('explica o bloqueio e oferece tentar de novo', async () => {
      const fixture = await render();
      const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

      expect(texto).toContain('Câmera bloqueada');
      expect(texto).toContain('Tentar de novo');
    });

    /**
     * ANCORA POSITIVA PRIMEIRO, e ela e o conserto deste caso.
     *
     * Este e o teste do REQUISITO CENTRAL, e ele passava COM CAMERA NENHUMA:
     * uma assercao de ausencia sozinha nao distingue "nao ha seletor na camera
     * viva" de "nao ha camera". Medido por controle: removendo o duble de
     * camera, 6 de 10 casos deste arquivo caem e ESTE sobrevivia.
     *
     * Entao primeiro se afirma que a folha REALMENTE montou a interface dela —
     * o disparo existe, e o aviso de bloqueio esta na tela —, e so depois a
     * ausencia do seletor. Mesmo padrao do `toHaveLength` antes do laco que o
     * lote de disciplina ja usa aqui.
     */
    it('NAO oferece seletor de arquivo em lugar nenhum', async () => {
      const fixture = await render();
      const host = fixture.nativeElement as HTMLElement;

      // 1) A folha existe e e ela que estamos medindo.
      expect(host.querySelector('button[aria-label^="Tirar foto"]')).not.toBeNull();
      expect(host.textContent).toContain('Câmera bloqueada');

      // 2) E, nela, nao ha caminho para arquivo.
      expect(host.querySelector('input[type="file"]')).toBeNull();
      expect(host.textContent).not.toContain('galeria');
    });

    it('o disparo fica desabilitado', async () => {
      const fixture = await render();
      const disparo = (fixture.nativeElement as HTMLElement).querySelector(
        'button[aria-label^="Tirar foto"]',
      ) as HTMLButtonElement;

      expect(disparo.disabled).toBe(true);
    });

    it('tentar de novo repede a camera', async () => {
      const fixture = await render();
      const botao = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).find((b) => b.textContent?.includes('Tentar de novo')) as HTMLButtonElement;

      botao.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();

      expect(getUserMedia).toHaveBeenCalledTimes(2);
    });
  });

  it('navegador sem getUserMedia nao vira "bloqueada" — e indisponivel', async () => {
    setMediaDevices(undefined);
    const fixture = await render();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Câmera indisponível');
    // Nao acusa o usuario de ter negado o que ele nunca viu.
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Câmera bloqueada');
  });

  /**
   * A camera TEM de desligar: stream vivo depois da folha morta acende a luz da
   * camera no celular do motorista e queima bateria.
   */
  describe('desligamento do stream', () => {
    it('para TODOS os tracks quando o componente e destruido', async () => {
      const fixture = await render();
      expect(tracks.every((t) => t.stop.mock.calls.length === 0)).toBe(true);

      fixture.componentInstance.aberta.set(false);
      fixture.detectChanges();

      expect(tracks.map((t) => t.stop.mock.calls.length)).toEqual([1, 1]);
    });

    it('para os tracks ao fechar pelo X', async () => {
      const fixture = await render();
      const fechar = (fixture.nativeElement as HTMLElement).querySelector(
        'button[aria-label="Fechar câmera"]',
      ) as HTMLButtonElement;

      fechar.click();

      expect(tracks.every((t) => t.stop.mock.calls.length >= 1)).toBe(true);
      expect(fixture.componentInstance.cancelado()).toBe(true);
    });

    it('nao deixa o video segurando o stream', async () => {
      const fixture = await render();
      const video = (fixture.nativeElement as HTMLElement).querySelector(
        'video',
      ) as HTMLVideoElement;

      fixture.componentInstance.aberta.set(false);
      fixture.detectChanges();

      expect(video.srcObject).toBeNull();
    });
  });
});
