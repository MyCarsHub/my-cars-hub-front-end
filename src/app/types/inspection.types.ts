

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
  readonly from?: string | null;
  readonly to?: string | null;
  readonly page?: number;
  readonly size?: number;
}
