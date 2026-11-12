import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  BLACK_FRAME_MESSAGE,
  CAMERA_STALLED_MESSAGE,
  CAMERA_START_TIMEOUT_MS,
  LiveCameraSheet,
  isUniformlyBlack,
} from './live-camera-sheet';

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

/**
 * O JSDOM nao decodifica video: `readyState` 0 e `videoWidth` 0 para sempre.
 * A folha so liga o disparo com frame real, entao a suite controla o que o
 * `<video>` reporta. Padrao: camera pronta, retrato 1080x1920.
 */
const videoState = { readyState: 4, videoWidth: 1080, videoHeight: 1920 };
const videoProps = ['readyState', 'videoWidth', 'videoHeight'] as const;

function stubVideoElement(): void {
  for (const prop of videoProps) {
    Object.defineProperty(HTMLVideoElement.prototype, prop, {
      configurable: true,
      get: () => videoState[prop],
    });
  }
  Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', {
    configurable: true,
    writable: true,
    value(cb: () => void) {
      queueMicrotask(cb);
      return 1;
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: () => Promise.resolve(),
  });
}

const originalPlay = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'play');

function unstubVideoElement(): void {
  if (originalPlay) Object.defineProperty(HTMLMediaElement.prototype, 'play', originalPlay);
  for (const prop of videoProps) {
    delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)[prop];
  }
  delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)['requestVideoFrameCallback'];
}

describe('isUniformlyBlack', () => {
  it('todo (0,0,0) e preto, independente do alfa', () => {
    expect(isUniformlyBlack(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]))).toBe(true);
  });

  it('um unico pixel acima do limite ja nao e preto', () => {
    expect(isUniformlyBlack(new Uint8ClampedArray([0, 0, 0, 255, 0, 40, 0, 255]))).toBe(false);
  });

  it('ruido de arredondamento abaixo do limite continua preto', () => {
    expect(isUniformlyBlack(new Uint8ClampedArray([2, 1, 3, 255]))).toBe(true);
  });
});

describe('LiveCameraSheet', { timeout: 15000 }, () => {
  let tracks: ReturnType<typeof fakeTrack>[];
  let getUserMedia: ReturnType<typeof vi.fn>;
  const originalMediaDevices = navigator.mediaDevices;

  beforeEach(() => {
    videoState.readyState = 4;
    videoState.videoWidth = 1080;
    videoState.videoHeight = 1920;
    stubVideoElement();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    unstubVideoElement();
  });

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
   * `getUserMedia` e assincrono. Nada aqui depende de velocidade de runner:
   * espera-se a CONDICAO (getUserMedia chamado e resolvido, estado final
   * renderizado), nunca um numero fixo de saltos de fila.
   */
  async function settle(fixture: ReturnType<typeof TestBed.createComponent<Host>>, calls = 1) {
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(calls), { timeout: 4000 });
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      // Sem API nao ha chamada a esperar: o estado "indisponivel" e sincrono.
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture;
    }
    await settle(fixture);
    // O estado final (disparo/aviso) aparece depois da promessa resolver.
    await vi.waitFor(
      () => {
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.textContent).not.toContain('Abrindo a');
      },
      { timeout: 4000 },
    );
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
      await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2), { timeout: 4000 });
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

  /**
   * Foto de vistoria chegou ao servidor como JPEG 400x300 todo (0,0,0): o
   * disparo estava ligado antes de o `<video>` ter frame decodificado.
   */
  describe('frame real antes do disparo', () => {
    let pixel: number[];
    /** Quando definido, substitui `pixel`: valor por pixel (cena escura com ruido). */
    let pixelAt: ((index: number) => number[]) | null;
    let drawCalls: number;
    let blobSizes: { width: number; height: number }[];

    function shutter(fixture: ReturnType<typeof TestBed.createComponent<Host>>): HTMLButtonElement {
      return (fixture.nativeElement as HTMLElement).querySelector(
        'button[aria-label^="Tirar foto"]',
      ) as HTMLButtonElement;
    }

    beforeEach(() => {
      pixel = [120, 110, 100, 255];
      pixelAt = null;
      drawCalls = 0;
      blobSizes = [];
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
        this: HTMLCanvasElement,
      ) {
        const canvas = this;
        return {
          imageSmoothingEnabled: true,
          drawImage: () => {
            // So conta o desenho do video no canvas do tamanho do frame; a
            // amostra 64x64 tambem desenha, mas a partir do canvas.
            if (canvas.width !== 64) drawCalls++;
          },
          getImageData: (_x: number, _y: number, w: number, h: number) => {
            const data = new Uint8ClampedArray(w * h * 4);
            for (let i = 0; i < data.length; i += 4) data.set(pixelAt ? pixelAt(i / 4) : pixel, i);
            return { data, width: w, height: h };
          },
        } as unknown as CanvasRenderingContext2D;
      } as unknown as HTMLCanvasElement['getContext']);
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        cb: BlobCallback,
      ) {
        blobSizes.push({ width: this.width, height: this.height });
        cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
      });
    });

    it('o disparo fica desligado enquanto o video nao tem dimensao nem frame', async () => {
      videoState.readyState = 0;
      videoState.videoWidth = 0;
      videoState.videoHeight = 0;
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();
      await settle(fixture);
      await fixture.whenStable();
      fixture.detectChanges();

      // Camera concedida, mas sem frame: continua "abrindo", disparo desligado.
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Abrindo a');
      expect(shutter(fixture).disabled).toBe(true);
      shutter(fixture).click();
      expect(drawCalls).toBe(0);
      expect(fixture.componentInstance.capturado()).toBeNull();

      // Primeiro frame decodificado: so agora o disparo liga.
      videoState.readyState = 2;
      videoState.videoWidth = 1080;
      videoState.videoHeight = 1920;
      (fixture.nativeElement as HTMLElement).querySelector('video')!.dispatchEvent(new Event('loadeddata'));
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(shutter(fixture).disabled).toBe(false);
      });
    });

    it('o canvas tem o tamanho real do video (retrato)', async () => {
      const fixture = await render();
      shutter(fixture).click();

      await vi.waitFor(() => expect(fixture.componentInstance.capturado()).not.toBeNull());
      expect(blobSizes).toEqual([{ width: 1080, height: 1920 }]);
      expect(fixture.componentInstance.capturado()!.type).toBe('image/jpeg');
    });

    it('frame todo preto: tenta uma vez de novo, nao envia e pede outra foto', async () => {
      pixel = [0, 0, 0, 255];
      const fixture = await render();
      shutter(fixture).click();

      await vi.waitFor(() => {
        fixture.detectChanges();
        expect((fixture.nativeElement as HTMLElement).textContent).toContain(BLACK_FRAME_MESSAGE);
      });
      expect(drawCalls).toBe(2);
      expect(blobSizes).toEqual([]);
      expect(fixture.componentInstance.capturado()).toBeNull();
      // A camera continua viva para a nova foto.
      expect(tracks.every((t) => t.stop.mock.calls.length === 0)).toBe(true);
      expect(shutter(fixture).disabled).toBe(false);
    });

    it('frame preto que volta com imagem na nova tentativa e aceito', async () => {
      pixel = [0, 0, 0, 255];
      const fixture = await render();
      // A camera entrega o frame real na espera da nova tentativa.
      Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', {
        configurable: true,
        writable: true,
        value(cb: () => void) {
          pixel = [90, 90, 90, 255];
          queueMicrotask(cb);
          return 1;
        },
      });
      shutter(fixture).click();

      await vi.waitFor(() => expect(fixture.componentInstance.capturado()).not.toBeNull());
      expect(drawCalls).toBe(2);
      expect(blobSizes).toHaveLength(1);
    });

    it('cena escura com ruido do sensor NAO e preto: a foto e aceita', async () => {
      // Noite de verdade: quase tudo perto de zero, mas o sensor sempre deixa
      // ruido acima do limite em algum canal.
      pixelAt = (i) => (i % 7 === 0 ? [9, 6, 11, 255] : [1, 2, 0, 255]);
      const fixture = await render();
      shutter(fixture).click();

      await vi.waitFor(() => expect(fixture.componentInstance.capturado()).not.toBeNull());
      expect(drawCalls).toBe(1);
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(BLACK_FRAME_MESSAGE);
    });

    /** iOS < 15.4 nao tem `requestVideoFrameCallback`: so o teto curto vale. */
    it('sem requestVideoFrameCallback a camera ainda liga e captura', async () => {
      delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)[
        'requestVideoFrameCallback'
      ];
      expect('requestVideoFrameCallback' in HTMLVideoElement.prototype).toBe(false);
      const fixture = await render();
      expect(shutter(fixture).disabled).toBe(false);

      shutter(fixture).click();
      await vi.waitFor(() => expect(fixture.componentInstance.capturado()).not.toBeNull(), {
        timeout: 4000,
      });
      expect(blobSizes).toEqual([{ width: 1080, height: 1920 }]);
    });

    /**
     * Frame que nunca chega (iOS recusando o play(), economia de energia,
     * camera tomada por outro app): a folha NAO pode ficar presa em "Abrindo a
     * câmera…" com a luz acesa. Desliga a camera, solta os ouvintes, explica e
     * oferece tentar de novo.
     */
    it(
      'frame que nunca chega: desliga a camera e oferece tentar de novo',
      { timeout: CAMERA_START_TIMEOUT_MS + 8000 },
      async () => {
        videoState.readyState = 0;
        videoState.videoWidth = 0;
        videoState.videoHeight = 0;
        const frameEvents = ['loadeddata', 'playing', 'resize', 'canplay'];
        const added = vi.spyOn(HTMLVideoElement.prototype, 'addEventListener');
        const removed = vi.spyOn(HTMLVideoElement.prototype, 'removeEventListener');
        const fixture = TestBed.createComponent(Host);
        fixture.detectChanges();
        await settle(fixture);

        await vi.waitFor(
          () => {
            fixture.detectChanges();
            expect((fixture.nativeElement as HTMLElement).textContent).toContain(
              'A câmera não abriu',
            );
          },
          { timeout: CAMERA_START_TIMEOUT_MS + 3000, interval: 200 },
        );
        const host = fixture.nativeElement as HTMLElement;
        expect(host.textContent).toContain(CAMERA_STALLED_MESSAGE);
        expect(host.textContent).not.toContain('Abrindo a');
        // Luz da camera apagada.
        expect(tracks.every((t) => t.stop.mock.calls.length >= 1)).toBe(true);
        // Todo ouvinte de frame posto foi tirado.
        const count = (spy: typeof added) =>
          spy.mock.calls.filter(([type]) => frameEvents.includes(type as string)).length;
        expect(count(added)).toBe(4);
        expect(count(removed)).toBe(count(added));
        expect(shutter(fixture).disabled).toBe(true);
        expect(fixture.componentInstance.capturado()).toBeNull();

        const retry = Array.from(host.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('Tentar de novo'),
        ) as HTMLButtonElement;
        expect(retry).toBeDefined();
        retry.click();
        await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2), { timeout: 4000 });
      },
    );
  });
});
