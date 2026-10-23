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
export type LiveCameraState = 'starting' | 'live' | 'denied' | 'unsupported';

/** Qualidade do JPEG gerado do frame. A compressao real vem depois, no mesmo
 *  `ImageCompressionService` que o seletor de arquivo usa — aqui so evitamos
 *  gerar um PNG gigante de um canvas de 12MP. */
const CAPTURE_QUALITY = 0.92;

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
      </div>

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

  private stream: MediaStream | null = null;

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
      this.stream = await media.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      const video = this.videoRef()?.nativeElement;
      if (video) {
        video.srcObject = this.stream;
      }
      this.state.set('live');
    } catch {
      // Negada, em uso por outro app, ou sem dispositivo: para o motorista o
      // caminho e o mesmo — liberar e tentar de novo. NUNCA o seletor.
      this.state.set('denied');
    }
  }

  protected capture(): void {
    const video = this.videoRef()?.nativeElement;
    if (this.state() !== 'live' || !video || this.capturing()) return;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // Sem contexto 2D nao ha frame: o JSDOM da suite e um deles. Nao e erro do
    // usuario e nao deve virar foto vazia.
    if (!ctx) return;

    this.capturing.set(true);
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        this.capturing.set(false);
        if (!blob) return;
        // Mesmo tipo que o seletor entrega; a compressao e o upload seguem o
        // MESMO caminho depois daqui (ver `ingestFile` no card).
        const file = new File([blob], `vistoria-${Date.now()}.jpg`, { type: 'image/jpeg' });
        this.stopStream();
        this.captured.emit(file);
      },
      'image/jpeg',
      CAPTURE_QUALITY,
    );
  }

  protected close(): void {
    this.stopStream();
    this.cancelled.emit();
  }

  /** Desliga a camera de verdade: track a track. Idempotente. */
  private stopStream(): void {
    const video = this.videoRef()?.nativeElement;
    if (video) video.srcObject = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
