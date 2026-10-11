

/**
 * Vistoria avulsa — a MESMA vistoria que hoje vive presa ao aluguel, vista de
 * fora dele.
 *
 * ## Conciliado com o backend real (PR #190, `feat/standalone-inspections`)
 *
 * A vistoria avulsa NÃO reaproveita `rental_photos`: o backend criou
 * `inspection_photos`, porque o índice único de `rental_photos` é
 * `(rental_id, kind, angle)` e no Postgres NULL não colide com NULL — com
 * `rental_id` nulo a garantia "uma foto por ângulo" morreria em silêncio
 * exatamente no caso novo.
 *
 * `InspectionKind` inclui `FLEET`: vistoria de frota, SEM aluguel. É por isso
 * que `rentalId` é nulável aqui — nulo significa "vistoria de frota", não
 * "dado faltando".
 */
export type InspectionKind = 'CHECKIN' | 'CHECKOUT' | 'FLEET';

/**
 * O DETALHE, exatamente como `InspectionDto` do PR #190.
 *
 * Campo a campo com o backend real — inclusive `performedAt` (e não
 * `inspectedAt`, que era o nome da minha proposta) e `requiredAngles`.
 */
export interface Inspection {
  readonly id: string;
  readonly companyId: string;
  readonly vehicleId: string;
  /** `null` = vistoria de FROTA, sem aluguel. Não é dado faltando. */
  readonly rentalId: string | null;
  readonly kind: InspectionKind;
  readonly performedBy: string | null;
  readonly performedAt: string;
  /**
   * RETRATO do roteiro exigido NO DIA da vistoria — não o roteiro vigente da
   * empresa. A diferença é a razão de o retrato existir: uma vistoria antiga
   * não pode passar a "faltar ângulo" porque a empresa mudou o roteiro depois.
   * Quem for dizer o que faltou lê DAQUI, nunca do checklist atual.
   */
  readonly requiredAngles: readonly string[];
  /**
   * Ângulos que JÁ têm foto. A tela de captura sabe o que falta subtraindo isto de
   * `requiredAngles` — é o que permite RETOMAR uma vistoria interrompida em vez de
   * recomeçar. Refotografar um ângulo SUBSTITUI (índice único no backend), então
   * reenviar não duplica.
   */
  readonly capturedAngles: readonly string[];
  /**
   * Em que ponto do ciclo a vistoria esta. E por ele que a tela de captura decide
   * o que mostrar: `PENDING` fotografa, `SUBMITTED`/`APPROVED` so mostram, e
   * `REJECTED` explica a recusa e oferece refazer.
   *
   * O detalhe SEMPRE traz este campo no backend atual. Segue opcional no tipo de
   * proposito: um servidor anterior a esta mudanca nao o manda, e a tela precisa
   * degradar para o comportamento antigo (captura) em vez de quebrar. Ausente
   * significa "nao sei", nunca "pendente" — por isso quem le usa `?? 'PENDING'`
   * num unico lugar (`InspectionCapture.status`).
   */
  readonly status?: InspectionStatus;
  /**
   * Por que o dono recusou. So vem quando `status === 'REJECTED'`; quem refotografa
   * precisa saber o que estava errado, entao a tela o mostra ANTES do botao de refazer.
   */
  readonly rejectionReason?: string | null;
  /** Quando o dono decidiu (ISO). So vem em vistoria decidida (`APPROVED`/`REJECTED`). */
  readonly reviewedAt?: string | null;
  /*
   * VISTORIAS v2 — o que a tela de DETALHES le. O backend devolve o MESMO record na lista e
   * no detalhe, entao estes campos chegam como na linha da lista. Todos opcionais de
   * proposito: uma resposta anterior as vistorias v2 nao os manda, e a tela degrada para
   * "—" em vez de inventar. A leitura mora em UM lugar: `pages/inspections/inspection-view.ts`.
   */
  readonly vehiclePlate?: string | null;
  readonly vehicleBrand?: string | null;
  readonly vehicleModel?: string | null;
  readonly vehicleColor?: string | null;
  readonly vehicleYear?: number | null;
  readonly driverName?: string | null;
  readonly driverPhone?: string | null;
  readonly photoCount?: number;
  /**
   * Hodometro (km) que o MOTORISTA informou ao enviar as fotos. `null`/ausente = ainda nao
   * informou — nunca zero, que seria um hodometro de 0 km.
   */
  readonly odometerKm?: number | null;
  /** Ultimo hodometro registrado do veiculo ANTES desta vistoria (km). */
  readonly previousOdometerKm?: number | null;
  /** `odometerKm - previousOdometerKm`, calculado pelo servidor. A tela NAO recalcula. */
  readonly kmDriven?: number | null;
}

/**
 * Estado do CICLO DE REVISAO — o que `submit`, `approve`, `reject` devolvem.
 *
 * ## Isto NAO e uma `Inspection`, e confundir as duas ja custou um defeito
 *
 * `POST /{id}/submit` devolve `InspectionReviewResponseDto`, nao `InspectionDto`:
 * NAO tem `requiredAngles` nem `capturedAngles`. A primeira versao do
 * `submit()` tipou o retorno como `Inspection` e a tela fazia
 * `inspection.set(resposta)` — em producao o cartao de progresso perderia os
 * angulos no instante do envio, e a lista de fotos esvaziaria.
 *
 * O TypeScript nao pegou (forma de runtime) e o spec passou porque o DUBLE
 * devolvia uma `Inspection` completa. O duble mentiu sobre o contrato, e um
 * duble que mente prova o CONTRARIO do que acontece em producao. Este tipo
 * existe para que o duble tenha uma forma certa para copiar.
 *
 * Campo a campo com o record do backend.
 */
/**
 * Uma foto enviada, como `GET /v1/inspections/{id}/photos` devolve.
 *
 * Campo a campo com o DTO real — ele espelha o irmao de fotos de aluguel.
 *
 * `angle` vem EXPLICITO, nao derivado da ordem: quem aprova precisa saber que
 * esta olhando a traseira, e nao a terceira foto. Ordem nao e rotulo.
 *
 * `signedUrl` tem VALIDADE CURTA e MUDA A CADA RECARGA. Nao guarde, nao
 * cacheie, e NUNCA use como chave de lista — veja `id`.
 *
 * ## `storagePath` NAO existe aqui, e a ausencia e deliberada
 *
 * O backend nao expoe o caminho do objeto no bucket: ele seria chave de acesso
 * ao storage. Nao o acrescente "para completar o tipo" se um dia vazar na
 * resposta — a ausencia e a decisao.
 */
export interface InspectionPhoto {
  /**
   * Chave ESTAVEL da lista. E por ela que o `@for` rastreia.
   *
   * Nao use `signedUrl`: ela e reassinada a cada carga, entao o Angular
   * destruiria e recriaria toda a galeria a cada recarga — e no celular isso e
   * 14 imagens baixadas de novo. Indice tambem nao: reordenar embaralha.
   */
  readonly id: string;
  readonly inspectionId: string;
  readonly angle: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /**
   * URL assinada, ou `null` quando a assinatura DAQUELA foto falhou.
   *
   * O backend isola a falha por item: uma foto que nao assina nao derruba a
   * resposta inteira — antes derrubava, e a tela mostrava zero em vez de 13 de
   * 14. O item continua vindo, com `signedUrl` nulo, e NAO e omitido: omitir
   * faria a lista parecer completa quando nao esta.
   *
   * Nulo significa "a foto EXISTE e nao consegui exibir", nunca "nao tem foto
   * deste angulo". A distincao decide o que a tela pode afirmar.
   */
  readonly signedUrl: string | null;
  /** Quando a foto foi enviada (ISO). */
  readonly createdDate: string;
}

export interface InspectionReviewResult {
  readonly id: string;
  /** `PENDING` -> `SUBMITTED` -> `APPROVED` | `REJECTED`. */
  readonly status: InspectionStatus;
  /** Nulo em vistoria que nao nasceu de um agendamento (frota avulsa). */
  readonly scheduleId: string | null;
  /** Data DEVIDA do ciclo (ISO). Nula sem agendamento. */
  readonly dueAt: string | null;
  readonly pdfDocumentId: string | null;
  /** A vistoria que esta substitui, quando nasceu de uma recusa. */
  readonly supersedesId: string | null;
}

/**
 * Os quatro estados que o backend emite. `APPROVED` e o unico que FECHA a
 * ocorrencia do ciclo — submeter nao basta, e por isso o lembrete do motor
 * continua ate alguem aprovar.
 */
export type InspectionStatus = 'PENDING' | 'SUBMITTED' | 'REJECTED' | 'APPROVED';

/** Corpo de `POST /v1/inspections`. `rentalId` nulo = vistoria de FROTA. */
export interface CreateInspectionRequest {
  vehicleId: string;
  rentalId: string | null;
  kind: InspectionKind;
}

/**
 * O item da LISTAGEM — `GET /v1/inspections`.
 *
 * Os campos que NAO estao em `InspectionDto` (placa, marca, modelo, motorista,
 * contagem de fotos) vem DENORMALIZADOS na linha para a tela nao fazer N+1
 * buscando veiculo por linha — mesma escolha que `FineListItem` e
 * `InsuranceListItem` ja fazem.
 *
 * ## Por que sao opcionais
 *
 * A primeira versao da listagem no backend NAO mandava esses campos, e a tela
 * renderizou linhas em branco sem erro nenhum — o tipo prometia o que o servidor
 * nao entregava. Agora eles chegam, mas seguem opcionais no tipo: uma resposta
 * antiga ou parcial tem de degradar para "Veiculo nao identificado" e para uma
 * linha sem contagem de fotos, nunca para "undefined foto(s)". Quem desenha a
 * linha trata a ausencia (`InspectionsList.vehicleLabel`, `photoCountLabel`).
 */
export interface InspectionListItem {
  readonly id: string;
  readonly rentalId: string | null;
  readonly vehicleId: string;
  readonly vehiclePlate?: string | null;
  readonly vehicleBrand?: string | null;
  readonly vehicleModel?: string | null;
  /** Quem dirigia no período da vistoria; `null` em aluguel sem motorista. */
  readonly driverName?: string | null;
  readonly kind: InspectionKind;
  /** Quando a vistoria foi feita (ISO). É por este campo que o filtro de datas recorta. */
  readonly performedAt: string;
  /**
   * Quantas fotos a vistoria tem — o tamanho de `capturedAngles` no detalhe.
   * Ausente = o servidor nao mandou a contagem; a linha omite a contagem em vez de
   * escrever zero, porque zero afirmaria que nao ha foto.
   */
  readonly photoCount?: number;
  /**
   * Em que ponto do ciclo a vistoria esta. E por este campo que o dono acha o
   * que lhe cabe decidir: `SUBMITTED` e a fila de aprovacao.
   */
  readonly status: InspectionStatus;
  /** Telefone do motorista, como cadastrado. Ausente = o servidor nao mandou. */
  readonly driverPhone?: string | null;
  readonly vehicleColor?: string | null;
  readonly vehicleYear?: number | null;
  /** Hodometro (km) informado pelo motorista; `null` = ainda nao informado. */
  readonly odometerKm?: number | null;
  /**
   * URL ASSINADA da foto do angulo FRONT, ou `null` quando a vistoria nao tem essa foto
   * (ou a assinatura falhou). E reassinada a cada carga: NUNCA use como chave de `@for`.
   */
  readonly frontPhotoUrl?: string | null;
  /*
   * TRÊS CAMPOS SAÍRAM DAQUI, e nenhum por descuido — nenhum tem coluna atrás.
   *
   * `rentalCode`: `rentals` tem só `id`. Não há `code`, `rental_code` nem
   * `contract_number`. Mostrar um código curto exige CRIAR a coluna primeiro;
   * não é dado que o backend esqueceu de mandar.
   *
   * `documentId` / `documentSignedUrl`: não existe tabela de documento de
   * VISTORIA. O PDF vive no mundo de ALUGUEL (`rental_documents`), e a V82
   * criou FOTOS, não laudo. O laudo de vistoria é FUNCIONALIDADE INTEIRA por
   * construir — está na especificação do dono e já subiu para ele —, não campo
   * faltando.
   *
   * Eles não voltam como opcionais só para o tipo casar: campo que o servidor
   * nunca manda, declarado opcional, vira coluna vazia permanente que ninguém
   * investiga. Este tipo nasceu como PROPOSTA de contrato, escrita antes de o
   * endpoint existir; cinco dos oito campos coincidiram com o real, e o que
   * faltou não foi cuidado — foi não haver endpoint com que comparar.
   */
}

/**
 * Filtros COMBINÁVEIS. Todos opcionais e todos aplicáveis ao mesmo tempo —
 * é o pedido do dono: veículo E locação E intervalo de datas.
 *
 * `from`/`to` são `yyyy-MM-dd` e recortam por `inspectedAt`, inclusive nas duas
 * pontas. Datas sem hora de propósito: o usuário filtra por dia, não por
 * instante, e a hora abriria a pergunta de fuso que o resto do app já resolveu
 * mostrando data.
 */
export interface InspectionFilters {
  readonly vehicleId?: string | null;
  readonly rentalId?: string | null;
  readonly kind?: InspectionKind | null;
  /** Filtra pelo ponto do ciclo. E o que da ao dono a fila do que aprovar. */
  readonly status?: InspectionStatus | null;
  readonly from?: string | null;
  readonly to?: string | null;
  /**
   * Busca por texto: placa, marca, modelo ou motorista. Ate `INSPECTION_SEARCH_MAX_LENGTH`
   * caracteres — o servidor corta o resto, entao a tela ja limita o campo.
   */
  readonly q?: string | null;
  /** Ordem por data de realizacao. Ausente = o padrao do servidor (mais recentes). */
  readonly sort?: InspectionSort | null;
  readonly page?: number;
  readonly size?: number;
}

/** Ordenacao da listagem — `sort=date,desc` e o padrao do produto (mais recentes primeiro). */
export type InspectionSort = 'date,desc' | 'date,asc';

/** Tamanho maximo da busca por texto aceito pelo servidor. */
export const INSPECTION_SEARCH_MAX_LENGTH = 60;

/** Teto do hodometro (km) que o servidor aceita no envio — acima disso e 400. */
export const INSPECTION_ODOMETER_MAX_KM = 5_000_000;

/**
 * `GET /v1/inspections/summary` — quantas vistorias ha em cada situacao.
 *
 * E a FONTE dos quatro tiles do topo da lista: quatro chamadas de lista so para ler `total`
 * custariam quatro viagens e quatro paginas descartadas. Nao e derivado da pagina carregada.
 */
export interface InspectionSummary {
  readonly pending: number;
  readonly submitted: number;
  readonly approved: number;
  readonly rejected: number;
}

/**
 * Corpo de `POST /v1/inspections/{id}/submit`. O hodometro e opcional no servidor (uma
 * versao anterior nao o pedia) e a tela de captura SEMPRE o envia.
 */
export interface SubmitInspectionRequest {
  readonly odometerKm: number;
}
