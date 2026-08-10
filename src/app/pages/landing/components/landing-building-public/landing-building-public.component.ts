import { ChangeDetectionStrategy, Component } from '@angular/core';

import {
  COMMUNITY_WHATSAPP_URL,
  INSTAGRAM_HANDLE,
  INSTAGRAM_URL,
} from '../../landing-community';

/**
 * Faixa "Estamos construindo em público", entre o CTA final e o rodapé.
 *
 * Só canais — nenhum número, nenhuma promessa. Os links vivem em
 * `landing-community.ts`; quando uma URL está vazia o canal simplesmente não é
 * renderizado, em vez de publicar um href quebrado OU um aviso de pendência.
 * Esta é uma página pública: recado para o time fica no código, não na tela.
 */
@Component({
  selector: 'app-landing-building-public',
  templateUrl: './landing-building-public.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class LandingBuildingPublicComponent {
  readonly communityUrl = COMMUNITY_WHATSAPP_URL;
  readonly instagramUrl = INSTAGRAM_URL;
  readonly instagramHandle = INSTAGRAM_HANDLE;

  /** Constantes de build, não estado: nada disso muda em runtime. */
  readonly hasAnyChannel = Boolean(COMMUNITY_WHATSAPP_URL || INSTAGRAM_URL);
}
