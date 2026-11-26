import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type AsaasIconName =
  | 'dots'
  | 'ext'
  | 'check'
  | 'x'
  | 'alert'
  | 'pix'
  | 'barcode'
  | 'card'
  | 'bolt'
  | 'flask'
  | 'pulse'
  | 'key'
  | 'help'
  | 'plug'
  | 'wa';

/**
 * Ícones da página do Asaas (os mesmos do desenho aprovado). Decorativos: o texto ao
 * lado diz o que é, então o `<svg>` fica fora da árvore de acessibilidade.
 */
@Component({
  selector: 'svg[appAsaasIcon]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    focusable: 'false',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  },
  template: `
    @switch (name()) {
      @case ('dots') {
        <svg:g fill="currentColor" stroke="none">
          <svg:circle cx="12" cy="5" r="1.9" />
          <svg:circle cx="12" cy="12" r="1.9" />
          <svg:circle cx="12" cy="19" r="1.9" />
        </svg:g>
      }
      @case ('ext') {
        <svg:path d="M14 3h7v7" />
        <svg:path d="M10 14 21 3" />
        <svg:path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
      }
      @case ('check') {
        <svg:path d="M20 6 9 17l-5-5" stroke-width="2.8" />
      }
      @case ('x') {
        <svg:path d="M18 6 6 18M6 6l12 12" stroke-width="2.6" />
      }
      @case ('alert') {
        <svg:circle cx="12" cy="12" r="10" />
        <svg:path d="M12 8v4M12 16h.01" />
      }
      @case ('pix') {
        <svg:path d="M12 2.5 21.5 12 12 21.5 2.5 12z" stroke-width="1.8" />
        <svg:path d="M7.5 7.5 12 12l4.5-4.5M7.5 16.5 12 12l4.5 4.5" stroke-width="1.8" />
      }
      @case ('barcode') {
        <svg:path d="M3 5v14M7 5v14M11 5v14M14 5v14M18 5v14M21 5v14" stroke-width="1.8" />
      }
      @case ('card') {
        <svg:rect x="2" y="5" width="20" height="14" rx="2" stroke-width="1.8" />
        <svg:path d="M2 10h20" stroke-width="1.8" />
      }
      @case ('bolt') {
        <svg:path d="M13 2 3 14h9l-1 8 10-12h-9z" />
      }
      @case ('flask') {
        <svg:path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3" />
        <svg:path d="M7 15h10" />
      }
      @case ('pulse') {
        <svg:path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke-width="1.8" />
      }
      @case ('key') {
        <svg:circle cx="7.5" cy="15.5" r="5.5" stroke-width="1.8" />
        <svg:path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" stroke-width="1.8" />
      }
      @case ('help') {
        <svg:circle cx="12" cy="12" r="10" stroke-width="1.8" />
        <svg:path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" stroke-width="1.8" />
      }
      @case ('plug') {
        <svg:path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z" stroke-width="1.8" />
      }
      @case ('wa') {
        <svg:path
          fill="currentColor"
          stroke="none"
          d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.5-.3z"
        />
      }
    }
  `,
})
export class AsaasIcon {
  readonly name = input.required<AsaasIconName>({ alias: 'appAsaasIcon' });
}
