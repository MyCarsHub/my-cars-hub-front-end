

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
  readonly signedUrl: string;
  /** Quando a foto foi enviada (ISO). Ordena a mais recente primeiro. */
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
 * O item da LISTAGEM.
 *
 * ATENÇÃO — a listagem AINDA NÃO EXISTE no backend. O PR #190 expõe só
 * `POST /v1/inspections`, `GET /v1/inspections/{id}` e
 * `GET /v1/inspections/checklist/{companyId}`. Não há `GET /v1/inspections`
 * com filtros.
 *
 * Os campos abaixo que NÃO estão no `InspectionDto` (placa, modelo, motorista,
 * contagem de fotos, PDF) são o que a listagem precisa trazer DENORMALIZADO
 * para a tela não fazer N+1 buscando veículo por linha — mesma escolha que
 * `FineListItem` e `InsuranceListItem` já fazem. É o pedido pendente ao
 * backend; os nomes que já existem estão idênticos ao DTO real.
 */
export interface InspectionListItem {
  readonly id: string;
  readonly rentalId: string | null;
  readonly vehicleId: string;
  readonly vehiclePlate: string;
  readonly vehicleBrand: string | null;
  readonly vehicleModel: string | null;
  /** Quem dirigia no período da vistoria; `null` em aluguel sem motorista. */
  readonly driverName: string | null;
  readonly kind: InspectionKind;
  /** Quando a vistoria foi feita (ISO). É por este campo que o filtro de datas recorta. */
  readonly performedAt: string;
  /**
   * Quantas fotos a vistoria tem. FICA — tem origem: o DTO devolve
   * `capturedAngles`, e a contagem é o tamanho dessa lista. Se o backend não
   * mandar `photoCount` pronto, derive daqui em vez de apagar a coluna; a
   * conferência dos NOMES das chaves contra este tipo é obrigatória quando o PR
   * do backend entrar, porque genérico de TypeScript não valida nada em runtime.
   */
  readonly photoCount: number;
  /**
   * Em que ponto do ciclo a vistoria esta. E por este campo que o dono acha o
   * que lhe cabe decidir: `SUBMITTED` e a fila de aprovacao.
   */
  readonly status: InspectionStatus;
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
  readonly page?: number;
  readonly size?: number;
}
