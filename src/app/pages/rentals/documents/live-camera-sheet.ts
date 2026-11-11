import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** Estado da folha. `denied` e terminal ate o motorista tentar de novo. */
export type LiveCameraState = 'starting' | 'live' | 'denied' | 'unsupported' | 'stalled';

/** Teto para a camera concedida entregar o primeiro frame decodificado. Depois
 *  disso a folha desliga a camera e oferece tentar de novo — nunca fica presa
 *  em "Abrindo a câmera…" com a luz da camera acesa. */
export const CAMERA_START_TIMEOUT_MS = 6000;

/** Copy do estado `stalled`. */
export const CAMERA_STALLED_MESSAGE =
  'Não conseguimos mostrar a imagem da câmera. Toque em tentar de novo; se continuar, feche outros apps que estejam usando a câmera.';

/** Qualidade do JPEG gerado do frame. A compressao real vem depois, no mesmo
 *  `ImageCompressionService` que o seletor de arquivo usa — aqui so evitamos
 *  gerar um PNG gigante de um canvas de 12MP. */
const CAPTURE_QUALITY = 0.92;

/** Lado da amostra usada para detectar frame preto: pixels reais (sem
 *  suavizacao), barato mesmo num frame de 12MP. */
const BLACK_SAMPLE_SIZE = 64;

/** Canal maximo (0-255) que ainda conta como "preto". Frame que a camera
 *  ainda nao entregou e (0,0,0) exato; o limite so absorve arredondamento. */
const BLACK_CHANNEL_MAX = 4;

/** Teto para esperar o primeiro frame pintado via `requestVideoFrameCallback`.
 *  Com o `<video>` invisivel alguns navegadores nao chamam o callback; a
 *  prontidao real ja foi provada por `readyState` antes de chegar aqui. */
const FIRST_FRAME_WAIT_MS = 800;

/** Espera antes da unica nova tentativa quando o frame veio preto. */
const BLACK_RETRY_WAIT_MS = 250;

/** HTMLMediaElement.HAVE_CURRENT_DATA: ha um frame decodificado para desenhar. */
const HAVE_CURRENT_DATA = 2;

/** Copy mostrada quando o frame continua preto depois da nova tentativa. */
export const BLACK_FRAME_MESSAGE = 'Não foi possível capturar a foto. Tire a foto de novo.';

/**
 * `true` quando TODOS os pixels amostrados sao pretos (RGBA; o alfa e
 * ignorado). Foto noturna de verdade tem ruido do sensor acima do limite; um
 * frame que a camera ainda nao entregou e uniformemente (0,0,0).
 */
export function isUniformlyBlack(rgba: ArrayLike<number>, channelMax = BLACK_CHANNEL_MAX): boolean {
  if (rgba.length < 4) return true;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i] > channelMax || rgba[i + 1] > channelMax || rgba[i + 2] > channelMax) {
      return false;
    }
  }
  return true;
}

/** Video com frame decodificado e dimensao real — o unico estado em que
 *  `drawImage` devolve a imagem da camera em vez de um retangulo preto. */
export function hasDecodedFrame(video: HTMLVideoElement): boolean {
  return video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0;
}

/**
 * CAMERA AO VIVO — a unica origem de foto de vistoria para o MOTORISTA.
 *
 * POR QUE AO VIVO E NAO `<input capture>`: `capture="environment"` e uma
 * SUGESTAO ao navegador. O usuario continua podendo trocar para a galeria em
 * boa parte dos Android, e no iOS o seletor nativo tambem oferece "Fototeca".
 * Para dono e gerente isso nao e problema; para o motorista e, porque e ele
 * quem tem interesse em mandar uma foto antiga do carro. Aqui o frame nasce do
 * `MediaStream` e vira `File` sem nunca passar pelo disco — nao ha caminho para
 * um arquivo escolhido.
 *
 * PERMISSAO NEGADA NAO CAI NO SELETOR. Cair no `<input type=file>` anularia a
 * regra inteira: bastaria negar a camera uma vez para reabrir a galeria. Os
 * estados `denied` e `unsupported` sao SEM SAIDA por design — so "tentar de
 * novo" ou cancelar. Quem nao consegue usar a camera nao envia foto por este
 * caminho, e o texto diz o que fazer (liberar nos ajustes do navegador).
 *
 * O DISPARO SO LIGA COM FRAME DE VERDADE: `srcObject` atribuido nao e camera
 * pronta. Entre a atribuicao e o primeiro frame decodificado o `<video>` ou nao
 * tem dimensao, ou ja tem a dimensao negociada (as vezes paisagem pequena) e
 * nenhum pixel ainda — e `drawImage` nesse intervalo gera um JPEG todo preto,
 * que chegou ao servidor como foto de vistoria. Por isso o estado so vira
 * `live` depois de `loadeddata`/`playing` com `videoWidth > 0` (e, quando o
 * navegador oferece, um `requestVideoFrameCallback`), e todo frame capturado
 * passa por `isUniformlyBlack` antes de virar arquivo: preto tenta uma vez de
 * novo e, se continuar preto, pede outra foto. NUNCA se envia frame preto.
 *
 * O STREAM MORRE COM A FOLHA: `stop()` em todos os tracks no fechamento e no
 * `ngOnDestroy`. Sem isso a luz da camera fica acesa no celular do motorista
 * depois que ele fecha a tela, e a bateria vai junto.
 */
@Component({
  selector: 'app-live-camera-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" [attr.aria-label]="label()">
      <!-- Cabecalho: alvo de 48px, alcancavel com o polegar de uma mao so. -->
      <div class="flex items-center justify-between gap-3 px-4 py-3 text-white shrink-0">
        <p class="text-sm font-semibold truncate">{{ label() }}</p>
        <button
          type="button"
          (click)="close()"
          class="shrink-0 min-h-[48px] min-w-[48px] inline-flex items-center justify-center rounded-full
                 text-white/90 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2
                 focus-visible:ring-white"
          aria-label="Fechar câmera"
        >
          ✕
        </button>
      </div>

      <div class="relative flex-1 min-h-0 flex items-center justify-center">
        <!--
          "playsinline" e obrigatorio: sem ele o iOS abre o video em tela cheia
          nativa e o botao de disparo some atras do player.
        -->
        <video
          #video
          class="h-full w-full object-cover"
          [class.invisible]="state() !== 'live'"
          autoplay
          muted
          playsinline
        ></video>

        @if (state() === 'starting') {
          <p class="absolute text-sm text-white/80">Abrindo a câmera…</p>
        }

        @if (state() === 'denied' || state() === 'unsupported') {
          <!--
            SEM saida para o seletor de arquivo — ver o bloco no topo do
            componente. As unicas saidas sao tentar de novo e fechar.
          -->
          <div class="absolute inset-x-0 px-6 text-center space-y-3">
            <p class="text-base font-semibold text-white">
              {{ state() === 'denied' ? 'Câmera bloqueada' : 'Câmera indisponível' }}
            </p>
            <p class="text-sm leading-relaxed text-white/80">
              {{
                state() === 'denied'
                  ? 'A foto da vistoria precisa ser tirada agora, pela câmera. Libere o acesso à câmera nas configurações do navegador e toque em tentar de novo.'
                  : 'Este navegador não permite usar a câmera. Abra a vistoria pelo navegador do celular (Chrome ou Safari) para tirar a foto.'
              }}
            </p>
            @if (state() === 'denied') {
              <button
                type="button"
                (click)="start()"
                class="min-h-[48px] px-5 rounded-xl bg-white text-neutral-900 text-sm font-semibold"
              >
                Tentar de novo
              </button>
            }
          </div>
        }

        @if (state() === 'stalled') {
          <!-- Permissao concedida, mas o video nao entregou frame no prazo. A
               camera ja foi desligada; o toque em tentar de novo e um gesto
               novo, que o iOS exige para deixar o play() rodar. -->
          <div class="absolute inset-x-0 px-6 text-center space-y-3" role="alert">
            <p class="text-base font-semibold text-white">A câmera não abriu</p>
            <p class="text-sm leading-relaxed text-white/80">{{ stalledMessage }}</p>
            <button
              type="button"
              (click)="start()"
              class="min-h-[48px] px-5 rounded-xl bg-white text-neutral-900 text-sm font-semibold"
            >
              Tentar de novo
            </button>
          </div>
        }
      </div>

      @if (captureError()) {
        <p class="shrink-0 px-6 pt-3 text-center text-sm font-semibold text-white" role="alert">
          {{ captureError() }}
        </p>
      }

      <!-- Disparo: barra inferior, polegar. Some quando nao ha video vivo. -->
      <div class="shrink-0 pb-8 pt-4 flex items-center justify-center">
        <button
          type="button"
          (click)="capture()"
          [disabled]="state() !== 'live' || capturing()"
          class="h-20 w-20 rounded-full border-4 border-white bg-white/20 disabled:opacity-40
                 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
          [attr.aria-label]="'Tirar foto: ' + label()"
        ></button>
      </div>
    </div>
  `,
})
export class LiveCameraSheet implements OnDestroy {
  /** Rotulo do angulo sendo fotografado — vai no titulo e no botao. */
  readonly label = input.required<string>();

  /** Frame capturado, ja como `File` JPEG. */
  readonly captured = output<File>();
  readonly cancelled = output<void>();

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  protected readonly state = signal<LiveCameraState>('starting');
  protected readonly capturing = signal(false);
  protected readonly captureError = signal<string | null>(null);
  protected readonly stalledMessage = CAMERA_STALLED_MESSAGE;

  private stream: MediaStream | null = null;
  /** Incrementa a cada parada do stream: a espera de frame de um stream antigo
   *  nao pode ligar o disparo de um stream novo (ou de uma folha fechada). */
  private generation = 0;

  constructor() {
    // Arranca sozinho: o motorista ja tocou no slot, pedir um segundo toque
    // para "ligar a camera" seria um passo a toa com o celular na mao.
    queueMicrotask(() => void this.start());
    inject(DestroyRef).onDestroy(() => this.stopStream());
  }

  ngOnDestroy(): void {
    this.stopStream();
  }

  protected async start(): Promise<void> {
    this.stopStream();
    const generation = this.generation;
    this.captureError.set(null);
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      this.state.set('unsupported');
      return;
    }
    this.state.set('starting');
    try {
      // `environment` = traseira. `ideal` e nao `exact` de proposito: num
      // aparelho sem camera traseira, `exact` falharia e cairia em "bloqueada",
      // acusando o usuario de negar o que ele nunca negou.
      const stream = await media.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (generation !== this.generation) {
        // Folha fechada (ou reiniciada) enquanto a permissao era pedida: o
        // stream novo nao tem dono e precisa morrer aqui.
        stopTracks(stream);
        return;
      }
      this.stream = stream;
      const video = this.videoRef()?.nativeElement;
      if (!video) {
        this.stopStream();
        this.state.set('stalled');
        return;
      }
      video.srcObject = this.stream;
      // `autoplay` cobre a maioria; `play()` explicito cobre o iOS quando o
      // atributo nao dispara depois de um `srcObject` programatico. Recusa
      // aqui nao e permissao negada — a espera abaixo decide.
      try {
        void video.play()?.catch(() => undefined);
      } catch {
        // JSDOM nao implementa play(); o navegador real sim.
      }
      // Disparo continua desligado ate haver frame real (ver bloco no topo).
      const ready = await this.waitForFirstFrame(video, CAMERA_START_TIMEOUT_MS);
      if (generation !== this.generation) return;
      if (!ready) {
        // Sem frame no prazo: desliga a camera (apaga a luz) e oferece tentar
        // de novo. Sem seletor de arquivo — ver o bloco no topo.
        this.stopStream();
        this.state.set('stalled');
        return;
      }
      this.state.set('live');
    } catch {
      // Negada, em uso por outro app, ou sem dispositivo: para o motorista o
      // caminho e o mesmo — liberar e tentar de novo. NUNCA o seletor.
      this.state.set('denied');
    }
  }

  protected async capture(): Promise<void> {
    const video = this.videoRef()?.nativeElement;
    if (this.state() !== 'live' || !video || this.capturing()) return;
    // Sem frame decodificado com dimensao real, `drawImage` so produz preto.
    if (!hasDecodedFrame(video)) return;

    // Fechar pelo X (ou reiniciar) durante a captura troca a geracao: o frame
    // em voo nao pode mais virar foto depois do `cancelled`.
    const generation = this.generation;
    this.capturing.set(true);
    this.captureError.set(null);
    try {
      let frame = this.grabFrame(video);
      // Sem contexto 2D nao ha frame: o JSDOM da suite e um deles. Nao e erro
      // do usuario e nao deve virar foto vazia.
      if (frame === null) return;
      if (frame === 'black') {
        // Uma nova tentativa: o primeiro frame depois de ligar (ou de a camera
        // reajustar a exposicao) as vezes ainda vem vazio.
        await this.nextFrame(video, BLACK_RETRY_WAIT_MS);
        if (generation !== this.generation) return;
        frame = hasDecodedFrame(video) ? this.grabFrame(video) : 'black';
        if (frame === null) return;
        if (frame === 'black') {
          this.captureError.set(BLACK_FRAME_MESSAGE);
          return;
        }
      }
      const canvas = frame;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', CAPTURE_QUALITY),
      );
      if (!blob || generation !== this.generation) return;
      // Mesmo tipo que o seletor entrega; a compressao e o upload seguem o
      // MESMO caminho depois daqui (ver `ingestFile` no card).
      const file = new File([blob], `vistoria-${Date.now()}.jpg`, { type: 'image/jpeg' });
      this.stopStream();
      this.captured.emit(file);
    } finally {
      this.capturing.set(false);
    }
  }

  /**
   * Desenha o frame atual num canvas do tamanho REAL do video (`videoWidth` x
   * `videoHeight`, retrato no celular em pe). `null` = sem contexto 2D;
   * `'black'` = o frame veio uniformemente preto.
   */
  private grabFrame(video: HTMLVideoElement): HTMLCanvasElement | 'black' | null {
    const width = video.videoWidth;
    const height = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return this.frameIsBlack(canvas) ? 'black' : canvas;
  }

  /** Reamostra o frame SEM suavizacao (pixels reais, nao media) e verifica se
   *  todos sao pretos. Sem leitura possivel, nao bloqueia o motorista. */
  private frameIsBlack(source: HTMLCanvasElement): boolean {
    const sample = document.createElement('canvas');
    sample.width = BLACK_SAMPLE_SIZE;
    sample.height = BLACK_SAMPLE_SIZE;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    try {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, 0, 0, BLACK_SAMPLE_SIZE, BLACK_SAMPLE_SIZE);
      return isUniformlyBlack(ctx.getImageData(0, 0, BLACK_SAMPLE_SIZE, BLACK_SAMPLE_SIZE).data);
    } catch {
      return false;
    }
  }

  /**
   * `true` quando o video tem frame decodificado com dimensao real
   * (`loadeddata`/`playing`/`resize` + `hasDecodedFrame`) e, quando houver
   * `requestVideoFrameCallback`, depois do primeiro frame apresentado.
   * `false` quando o frame nao chega em `timeoutMs` (iOS recusando o `play()`,
   * modo de economia de energia, camera tomada por outro app) — os ouvintes
   * saem nos DOIS caminhos.
   */
  private async waitForFirstFrame(video: HTMLVideoElement, timeoutMs: number): Promise<boolean> {
    if (!hasDecodedFrame(video)) {
      const ready = await new Promise<boolean>((resolve) => {
        const events = ['loadeddata', 'playing', 'resize', 'canplay'] as const;
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          events.forEach((e) => video.removeEventListener(e, check));
          resolve(ok);
        };
        const check = () => {
          if (hasDecodedFrame(video)) finish(true);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        events.forEach((e) => video.addEventListener(e, check));
      });
      if (!ready) return false;
    }
    await this.nextFrame(video, FIRST_FRAME_WAIT_MS);
    return true;
  }

  /** Proximo frame apresentado (`requestVideoFrameCallback`) com teto de
   *  tempo; sem a API, so o teto. */
  private nextFrame(video: HTMLVideoElement, maxWaitMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(finish, maxWaitMs);
      let done = false;
      function finish(): void {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      }
      const rvfc = (
        video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
      ).requestVideoFrameCallback;
      if (typeof rvfc === 'function') rvfc.call(video, finish);
    });
  }

  protected close(): void {
    this.stopStream();
    this.cancelled.emit();
  }

  /** Desliga a camera de verdade: track a track. Idempotente. */
  private stopStream(): void {
    this.generation++;
    const video = this.videoRef()?.nativeElement;
    if (video) video.srcObject = null;
    stopTracks(this.stream);
    this.stream = null;
  }
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
