import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, Subject, catchError, map, of, retry, switchMap } from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { PageCard } from '../../../components/core/page-card/page-card';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { BackLink } from '../../../components/core/back-link/back-link';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../../services/api-error.service';
import { clearServerErrors } from '../../../services/api-error';
import { CepLookupResult, CepService } from '../../../services/cep.service';
import { CompanyContactService } from '../../../services/company-contact.service';
import { NotificationService } from '../../../services/notification.service';
import {
  CompanyContactPayload,
  CompanyContactSnapshot,
} from '../../../types/company-contact.types';
import { applyMaskedCepInput, maskCep, normalizeCep } from '../../../utils/cep-mask';
import { applyMaskedPhoneInput, maskPhone } from '../../../utils/phone-mask';
import { allOrNothingBlock } from '../../../utils/validators/all-or-nothing.validator';

const LOAD_FALLBACK = 'Não foi possível carregar os dados de contato da empresa.';
const SAVE_FALLBACK = 'Não foi possível salvar os dados de contato da empresa.';

/**
 * Cópia do `required` em TODOS os campos do bloco.
 *
 * "Campo obrigatório." (o padrão de `validation-messages`) seria mentira aqui: o
 * usuário PODE deixar este campo vazio, desde que deixe os outros dez também. A
 * mensagem precisa dizer a regra inteira, senão o formulário parece contraditório.
 */
const BLOCK_RULE = 'Preencha todos os campos ou deixe o bloco inteiro em branco.';

/**
 * `CepService.lookup` devolve `null` tanto para CEP inexistente quanto para falha de
 * rede — ele engole o erro. `driver-form` depende dessa assinatura, então ela não muda
 * aqui; a tela apenas evita afirmar qual dos dois foi.
 */
const CEP_LOOKUP_FAILED =
  'CEP não encontrado ou serviço indisponível. Preencha o endereço à mão.';

/** Texto único do "consultando": o hint visível e a região de status leem daqui. */
const CEP_SEARCHING = 'Buscando endereço…';

/** Comprimento do CEP cru — abaixo disso não há o que consultar. */
const CEP_DIGITS = 8;

/**
 * Id fixo do aviso de busca de CEP.
 *
 * O aviso é projetado DENTRO do `app-form-field`, mas não é nem o `hint` nem um erro
 * de validação — o campo continua válido. Sem um id estável para entrar no
 * `aria-describedby`, o texto existiria só para quem vê a tela: voltar ao campo não
 * leria nada, e com um erro de `pattern` junto o usuário ouviria só um dos dois textos.
 * Quem ANUNCIA a falha é a região de status (`cepStatusMessage`), não este parágrafo.
 */
const CEP_WARNING_ID = 'empresa-cep-aviso';

/** Único campo do bloco que continua livre: muitos endereços não têm complemento. */
const OPTIONAL_FIELD = 'addressComplement';

/**
 * `cancelled` = consulta abandonada (o usuário apagou dígitos), não "CEP não achado".
 * `digits` viaja junto porque só o desfecho sabe se aquele CEP pode ser marcado como
 * já consultado — falha não pode marcar, senão o retry fica impossível.
 */
type CepOutcome =
  | { kind: 'cancelled' }
  | { kind: 'done'; digits: string; result: CepLookupResult | null };

/** Statuses que o `errorInterceptor` já mostra em toast — repetir no banner diria duas vezes. */
function ownedByInterceptor(status: number): boolean {
  return status === 0 || status === 401 || status === 403 || status >= 500;
}

/** `scrollIntoView` não existe no jsdom nem em alguns navegadores móveis antigos. */
function centre(element: HTMLElement | null): void {
  if (element && typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ block: 'center' });
  }
}

/** Trim local só para não mandar espaço à toa; o backend também normaliza. */
function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * Configurações → Dados de contato da empresa (`/configuracoes/contato`).
 *
 * Preenche as variáveis `{{companyPhone}}`, `{{companyEmail}}`, `{{companyAddress}}`,
 * `{{companyCep}}`, `{{companyRepresentative}}` e `{{companyRepresentativeRole}}` do
 * template de contrato. Campo vazio aqui sai vazio no contrato.
 *
 * Três decisões estruturais, todas por causa da semântica do backend:
 *
 * 1. **Rota e serviço próprios, fora de `CompanySettings`.** Aquela tela tem uma
 *    corrida conhecida (o `patchValue` do GET sobrescreve o que o usuário já
 *    digitou) e lê de um endpoint enquanto grava em outro — dois defeitos já na
 *    fila. Construir em cima deles seria fatal aqui, onde o `PUT` substitui o
 *    bloco inteiro: um campo perdido no caminho não fica em branco na tela, é
 *    APAGADO no banco.
 *
 * 2. **O formulário só existe depois que o GET responde.** Enquanto carrega, o
 *    template mostra esqueleto — não há campo para digitar, logo não há o que
 *    sobrescrever quando a resposta chega. A corrida não é contornada, ela deixa
 *    de ter janela. Falha no GET não rende formulário nenhum: sem o `name` real
 *    carregado, salvar renomearia a empresa (`name` é `@NotBlank` no `PUT`).
 *
 * 3. **O bloco vai sempre inteiro.** `buildPayload()` lista as onze chaves de
 *    propósito e `CompanyContactPayload` recusa em compilação um objeto parcial.
 *    Campo em branco viaja como `''` — é assim, e só assim, que o usuário limpa
 *    um valor.
 *
 * E uma decisão de produto, do dono: **tudo ou nada.** O contrato gerado interpola o
 * bloco de contato inteiro; meio preenchido sai com buracos no meio do texto. Então
 * ou o bloco está todo em branco (empresa que ainda não configurou, e é assim que ela
 * apaga o que gravou) ou está todo preenchido — só o complemento fica de fora, porque
 * muitos endereços não têm. Isto é política do CLIENTE: `CompanyContactDto` no
 * backend não tem um `@NotBlank` sequer e continua aceitando bloco parcial.
 */
@Component({
  selector: 'app-company-contact',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    BackLink,
    ReactiveFormsModule,
    DefaultPageLayout,
    PageCard,
    AlertBanner,
    FormField,
    FieldControl,
  ],
  templateUrl: './company-contact.html',
})
export class CompanyContact implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(CompanyContactService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);
  private readonly cepService = inject(CepService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);

  /** Consulta de CEP em voo — vira o `hint` do campo. */
  protected readonly cepLoading = signal(false);
  /** Aviso visível quando a consulta não trouxe endereço. Não bloqueia salvar. */
  protected readonly cepLookupError = signal<string | null>(null);

  /**
   * Linha de status da consulta de CEP — a região `aria-live="polite"` do template.
   *
   * Existe porque a consulta é uma mensagem de status (WCAG 4.1.3) e nada dela chegava
   * a quem não vê a tela: o "Buscando endereço…" saía num `<p>` mudo, o sucesso
   * repovoava quatro campos em silêncio e a falha vinha num `role="alert"` que, uma vez
   * montado com o mesmo texto, não re-anunciava a SEGUNDA falha.
   *
   * A região é única e fica sempre montada: uma região que entra e sai do DOM não é
   * anunciada de forma confiável, e duas regiões diriam a mesma coisa duas vezes. Por
   * isso o aviso visível abaixo do campo é só visual (sem `role="alert"`) — quem
   * anuncia é esta linha, e ela cobre os três momentos: início, endereço resolvido e
   * falha (inclusive a repetida, porque o texto passa por "Buscando endereço…" entre
   * uma tentativa e outra e portanto MUDA).
   */
  protected readonly cepStatusMessage = signal('');

  /**
   * Uma linha auxiliar de cada vez sob o CEP. Com a busca falhada, "preenche sozinho"
   * viraria uma promessa desmentida logo acima — some enquanto o aviso está na tela.
   */
  protected readonly cepHint = computed(() => {
    // O aviso na tela tem precedência sobre o hint, inclusive durante a nova tentativa:
    // ali quem diz "estou buscando" é o próprio botão, e o hint repetindo isso deixaria
    // três textos simultâneos sob o mesmo campo — um deles contradizendo o outro.
    if (this.cepLookupError()) return '';
    return this.cepLoading() ? CEP_SEARCHING : 'Preenche o endereço sozinho.';
  });

  /**
   * Amarra o aviso ao input. Vazio quando não há aviso — `describedByExtra` ignora
   * string vazia, então o `aria-describedby` volta a apontar só para o hint ou para o
   * erro de validação. Com os dois na tela, aponta para os dois.
   */
  protected readonly cepDescribedByExtra = computed(() =>
    this.cepLookupError() ? CEP_WARNING_ID : '',
  );

  /** Id fixo exposto ao template — o `<p>` do aviso e o `aria-describedby` usam o mesmo. */
  protected readonly cepWarningId = CEP_WARNING_ID;

  /**
   * O que o servidor devolveu no último carregamento (ou salvamento) bem-sucedido.
   * Guarda o `name`, que precisa voltar no `PUT`. `null` = nada carregado ainda,
   * e nesse estado salvar é proibido.
   */
  protected readonly snapshot = signal<CompanyContactSnapshot | null>(null);

  /**
   * Limites espelhados do backend (`CompanyContactDto`). Divergir daqui só
   * adiantaria o 400 para o cliente; o servidor continua sendo a autoridade.
   */
  protected readonly form = this.fb.nonNullable.group({
    contact: this.fb.nonNullable.group(
      {
        phone: ['', [Validators.maxLength(30)]],
        email: ['', [Validators.email, Validators.maxLength(180)]],
        addressStreet: ['', [Validators.maxLength(180)]],
        addressNumber: ['', [Validators.maxLength(20)]],
        addressComplement: ['', [Validators.maxLength(120)]],
        addressDistrict: ['', [Validators.maxLength(120)]],
        // A máscara garante o hífen; `pattern` deixa passar o vazio, que é omissão válida.
        addressCep: ['', [Validators.pattern(/^\d{5}-\d{3}$/)]],
        addressCity: ['', [Validators.maxLength(120)]],
        // Exatamente duas letras: a coluna tem CHECK de 2 caracteres, então "S"
        // passaria por um `maxLength` e viraria erro só no servidor.
        addressUf: ['', [Validators.pattern(/^[A-Za-z]{2}$/)]],
        representativeName: ['', [Validators.maxLength(200)]],
        representativeRole: ['', [Validators.maxLength(120)]],
      },
      {
        // Tudo ou nada. O validador é do GRUPO porque a obrigatoriedade depende dos
        // irmãos: onze `Validators.required` nunca deixariam o bloco todo em branco
        // passar, que é justamente como o usuário apaga o contato da empresa.
        validators: [allOrNothingBlock([OPTIONAL_FIELD])],
      },
    ),
  });

  protected get contactGroup() {
    return this.form.controls.contact;
  }

  /**
   * Valor do bloco como sinal — reactive forms não são sinais, então o `valueChanges`
   * é espelhado para alimentar o `computed` abaixo.
   */
  private readonly contactValue = toSignal(this.form.controls.contact.valueChanges, {
    initialValue: this.form.controls.contact.getRawValue(),
  });

  /**
   * `true` assim que qualquer campo do bloco tem valor — ou seja, quando os outros
   * passaram a ser obrigatórios AGORA. É isto que acende os `*` e o `aria-required`:
   * marcador fixo mentiria enquanto o bloco em branco ainda é uma opção válida.
   */
  protected readonly blockStarted = computed(() =>
    Object.values(this.contactValue()).some((value) => (value ?? '').trim().length > 0),
  );

  /** Um envio já foi recusado. Antes disso, banner de bloco incompleto seria barulho. */
  private readonly saveAttempted = signal(false);

  /** `errors`/`touched` do grupo não são sinais — o fluxo de eventos os espelha. */
  private readonly contactEvents = toSignal(this.form.controls.contact.events);

  /**
   * Rede de segurança do `blockIncomplete`.
   *
   * Toda a cobrança normalmente aparece NOS campos, via a chave `required` que o
   * validador de bloco escreve neles — é lá que o usuário de celular consegue ver.
   * Mas o erro do GRUPO não tinha superfície nenhuma: se um filho perdesse o
   * `required` sem o grupo re-rodar, `save()` viraria um no-op silencioso
   * (`form.invalid`, `markAllAsTouched()` sem nada para mostrar, e o `revealFirstError`
   * caindo num `[data-save-error]` que não está no DOM). Este banner é a última linha,
   * e só depois de um envio recusado.
   */
  protected readonly blockIncomplete = computed(() => {
    this.contactEvents();
    if (!this.saveAttempted()) return false;
    const errors = this.form.controls.contact.errors;
    return errors !== null && 'blockIncomplete' in errors;
  });

  // Todo mapa abaixo tem `required: BLOCK_RULE` — sem ele o erro do validador de bloco
  // cairia no texto genérico "Campo obrigatório.", que contradiz um formulário que o
  // usuário poderia ter deixado inteiramente vazio. O complemento é o único sem a
  // chave: ele nunca fica obrigatório.
  protected readonly phoneMessages: Readonly<Record<string, string>> = {
    required: BLOCK_RULE,
    maxlength: 'O telefone deve ter no máximo 30 caracteres.',
  };
  protected readonly emailMessages: Readonly<Record<string, string>> = {
    required: BLOCK_RULE,
    email: 'Informe um e-mail válido.',
    maxlength: 'O e-mail deve ter no máximo 180 caracteres.',
  };
  protected readonly cepMessages: Readonly<Record<string, string>> = {
    required: BLOCK_RULE,
    pattern: 'CEP inválido (00000-000).',
  };
  protected readonly ufMessages: Readonly<Record<string, string>> = {
    required: BLOCK_RULE,
    pattern: 'A UF deve ter exatamente 2 letras (ex.: SP).',
  };
  protected readonly streetMessages: Readonly<Record<string, string>> = {
    required: BLOCK_RULE,
    maxlength: 'O logradouro deve ter no máximo 180 caracteres.',
  };
  protected readonly numberMessages: Readonly<Record<string, string>> = {
    required: BLOCK_RULE,
    maxlength: 'O número deve ter no máximo 20 caracteres.',
  };
  protected readonly complementMessages: Readonly<Record<string, string>> = {
    maxlength: 'O complemento deve ter no máximo 120 caracteres.',
  };
  protected readonly districtMessages: Readonly<Record<string, string>> = {
    required: BLOCK_RULE,
    maxlength: 'O bairro deve ter no máximo 120 caracteres.',
  };
  protected readonly cityMessages: Readonly<Record<string, string>> = {
    required: BLOCK_RULE,
    maxlength: 'A cidade deve ter no máximo 120 caracteres.',
  };
  protected readonly representativeMessages: Readonly<Record<string, string>> = {
    required: BLOCK_RULE,
    maxlength: 'O nome deve ter no máximo 200 caracteres.',
  };
  protected readonly roleMessages: Readonly<Record<string, string>> = {
    required: BLOCK_RULE,
    maxlength: 'O cargo deve ter no máximo 120 caracteres.',
  };

  /** Sem snapshot não há `name` para devolver no `PUT` — salvar fica bloqueado. */
  protected readonly canSave = computed(() => this.snapshot() !== null && !this.saving());

  /** `true` quando a empresa nunca preencheu nada — vira aviso de contrato incompleto. */
  protected readonly neverFilled = signal(false);

  /** Fila de consultas de CEP — `null` cancela a que estiver em voo. */
  private readonly cepQueries = new Subject<string | null>();

  /**
   * Último CEP consultado COM SUCESSO, para não repetir a chamada a cada tecla depois
   * do 8º dígito. Falha não entra aqui de propósito: marcar um CEP que não respondeu
   * como "já consultado" deixaria aquele número impossível de tentar de novo sem
   * apagar um dígito e redigitar.
   */
  private lastCepQueried = '';

  /** CEP da consulta em voo — trava a repetição enquanto a resposta não chega. */
  private cepInFlight = '';

  /**
   * Busca bem-sucedida deixou o Número em branco. O salto de foco espera o `(blur)`
   * do CEP: mover o foco como consequência direta de uma tecla é mudança de contexto
   * sem aviso (WCAG 3.2.2) e, no celular, re-ancora o teclado no meio da digitação.
   */
  private numberFocusPending = false;

  /**
   * Uma nova tentativa saiu do BOTÃO "Tentar de novo".
   *
   * Se ela der certo, o aviso e o próprio botão saem da tela — e o foco de quem
   * acabou de clicar cairia no `<body>`: leitor de tela perde o lugar e o Tab
   * recomeça do topo do documento. Neste caso o foco volta para o campo de CEP, que
   * é o elemento estável logo acima. Falha não mexe em nada: o botão continua lá.
   */
  private cepRetryFromButton = false;

  ngOnInit(): void {
    this.watchCepQueries();
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.saveError.set(null);

    this.service.load().subscribe({
      next: (snapshot) => {
        this.adopt(snapshot);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.snapshot.set(null);
        this.loadError.set(this.apiErrors.messageFor(err, LOAD_FALLBACK));
      },
    });
  }

  /** Máscara `(00) 00000-0000` com caret preservado. */
  protected onPhoneInput(event: Event): void {
    applyMaskedPhoneInput(event, this.contactGroup.controls.phone);
  }

  /**
   * Máscara `00000-000` com caret preservado — e, fechado o oitavo dígito, a busca do
   * endereço.
   *
   * `driver-form` dispara no `(blur)`; aqui a máscara já roda a cada tecla, então o
   * momento exato em que o CEP fica completo é conhecido de graça e o endereço aparece
   * sem o usuário precisar sair do campo. É melhor no celular, onde "sair do campo"
   * costuma significar fechar o teclado.
   */
  protected onCepInput(event: Event): void {
    applyMaskedCepInput(event, this.contactGroup.controls.addressCep);
    this.requestCepLookup(this.contactGroup.controls.addressCep.value);
  }

  /**
   * Sair do CEP é o momento seguro para levar o usuário ao Número: ele já terminou de
   * digitar, então o foco não pula debaixo do dedo e o teclado virtual não se
   * re-ancora no meio da palavra.
   *
   * Só que "sair do campo" quase nunca é sair para lugar nenhum. No celular, tocar em
   * Complemento, em Bairro ou no botão Salvar dispara este `blur` ANTES de o alvo do
   * toque receber o foco: o salto chegava primeiro e jogava o usuário no Número,
   * desfazendo o toque que ele acabou de dar. Daí a guarda: o salto só acontece quando
   * o `blur` não tem destino próprio (`relatedTarget` nulo — Tab a partir de um campo
   * sem sucessor, ou o foco simplesmente sendo largado). Havendo destino, o navegador
   * já sabe para onde ir e esta tela não interfere.
   *
   * `relatedTarget` ausente (um `Event` genérico, não um `FocusEvent`) conta como "sem
   * destino": é o mesmo caso, escrito de outro jeito.
   */
  protected onCepBlur(event: FocusEvent): void {
    if (!this.numberFocusPending) return;
    // O salto é consumido na primeira saída do campo, com destino ou sem: se o usuário
    // já escolheu para onde ir, a intenção morre aqui em vez de ficar guardada para
    // disparar num `blur` futuro que ele não vai relacionar com nada.
    this.numberFocusPending = false;
    if (event.relatedTarget) return;
    if (this.contactGroup.controls.addressNumber.value.trim()) return;
    this.focusAddressNumber();
  }

  /**
   * Nova tentativa explícita para o CEP que já está no campo.
   *
   * Só existe enquanto o aviso está na tela. Com `lastCepQueried` gravado apenas em
   * caso de sucesso, esta chamada realmente sai — antes, o mesmo CEP era descartado
   * como "já consultado" e o usuário ficava sem saída além de reeditar os dígitos.
   */
  protected retryCepLookup(): void {
    // Ocupado: o botão já se anuncia como `aria-disabled` e trocou de rótulo, mas ele
    // continua focável de propósito (ver o template), então o clique/Enter precisa
    // morrer aqui também.
    if (this.cepLoading()) return;
    this.cepRetryFromButton = true;
    this.requestCepLookup(this.contactGroup.controls.addressCep.value);
  }

  /**
   * Assina a fila uma vez só. O `switchMap` descarta a resposta de um CEP que o usuário
   * já abandonou — sem ele, uma consulta lenta poderia sobrescrever o endereço de uma
   * consulta mais nova.
   */
  private watchCepQueries(): void {
    this.cepQueries
      .pipe(
        switchMap((digits) =>
          digits === null
            ? of<CepOutcome>({ kind: 'cancelled' })
            : this.cepService.lookup(digits).pipe(
                map((result): CepOutcome => ({ kind: 'done', digits, result })),
                // O erro morre AQUI, no observável interno. `CepService.lookup` hoje
                // engole tudo e devolve `null`, mas isso é contrato dele, não desta
                // tela: se um dia deixar o erro passar, sem este `catchError` ele
                // subiria pelo `switchMap` e mataria a assinatura pelo resto da vida
                // do componente — `cepLoading` preso em `true` e o hint congelado em
                // "Buscando endereço…". Falha vira o mesmo desfecho de CEP não achado.
                catchError(() => of<CepOutcome>({ kind: 'done', digits, result: null })),
              ),
        ),
        // Segunda barreira, para o que não nasce dentro do `switchMap`. Re-assina o
        // `Subject` (que é quente e nunca erra) em vez de morrer calado; o limite
        // existe para não virar laço caso a fonte um dia erre na própria inscrição.
        retry({ count: 2, delay: 0 }),
        catchError(() => {
          this.cepLoading.set(false);
          this.cepInFlight = '';
          this.cepRetryFromButton = false;
          this.cepStatusMessage.set('');
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((outcome) => this.absorbCepLookup(outcome));
  }

  /** Decide se há o que consultar e evita repetir o mesmo CEP. */
  private requestCepLookup(value: string): void {
    const digits = normalizeCep(value);

    if (digits.length !== CEP_DIGITS) {
      // CEP incompleto de novo: esquece o último consultado para que voltar ao mesmo
      // número volte a buscar, e cancela o que estiver em voo.
      this.lastCepQueried = '';
      this.cepInFlight = '';
      this.numberFocusPending = false;
      this.cepLookupError.set(null);
      this.cepStatusMessage.set('');
      if (this.cepLoading()) this.cepQueries.next(null);
      return;
    }

    // Sucesso anterior no mesmo número, ou a mesma consulta já em voo: nada a fazer.
    // Uma FALHA anterior não entra nesta guarda — é o que torna o retry possível.
    if (digits === this.lastCepQueried || digits === this.cepInFlight) return;

    this.cepInFlight = digits;
    this.cepLoading.set(true);
    this.cepStatusMessage.set(CEP_SEARCHING);
    this.cepQueries.next(digits);
  }

  /**
   * `CepService` engole o erro e devolve `null` tanto para CEP inexistente quanto para
   * falha de rede. Quando os campos eram opcionais dava para ignorar em silêncio, como
   * `driver-form` faz; agora eles são obrigatórios, e um endereço que não se preenche
   * sozinho e não explica por quê deixa o usuário parado. Daí a mensagem visível.
   */
  private absorbCepLookup(outcome: CepOutcome): void {
    this.cepLoading.set(false);
    this.cepInFlight = '';

    // A flag é lida e zerada ANTES do desvio de cancelamento. Sair por cima dela
    // deixava "veio do botão" ligado quando o usuário clicava no retry e apagava um
    // dígito antes da resposta — e a próxima consulta, sem relação nenhuma com aquele
    // clique, herdava o salto de foco para o CEP.
    const fromButton = this.cepRetryFromButton;
    this.cepRetryFromButton = false;

    if (outcome.kind === 'cancelled') {
      this.cepStatusMessage.set('');
      return;
    }

    if (outcome.result === null) {
      // O aviso fica montado durante uma nova tentativa (nada o apaga na saída da
      // consulta), então o botão "Tentar de novo" não some debaixo do foco de quem
      // acabou de clicar nele.
      this.cepLookupError.set(CEP_LOOKUP_FAILED);
      // E o anúncio SAI de novo a cada falha: entre uma tentativa e outra a região
      // passou por "Buscando endereço…", então o texto muda e o leitor de tela lê.
      // Era exatamente isso que o `role="alert"` montado uma única vez não fazia.
      this.cepStatusMessage.set(CEP_LOOKUP_FAILED);
      return;
    }

    this.lastCepQueried = outcome.digits;
    this.cepLookupError.set(null);
    // Deu certo: o aviso e o botão saem do DOM. Sem devolver o foco ao campo de CEP,
    // ele cairia no `<body>` — Tab recomeçando do topo, leitor de tela sem contexto.
    // Só se o foco AINDA estiver no botão: numa consulta lenta o usuário pode ter
    // seguido em frente, e aí puxá-lo de volta seria a mudança de contexto que esta
    // tela acabou de deixar de fazer.
    if (fromButton && this.retryButtonHasFocus()) this.focusCep();

    const controls = this.contactGroup.controls;
    // `|| valor atual`: campo que o ViaCEP devolve vazio (CEP de logradouro único, por
    // exemplo) não pode apagar o que o usuário já digitou.
    this.contactGroup.patchValue({
      addressStreet: outcome.result.street || controls.addressStreet.value,
      addressDistrict: outcome.result.district || controls.addressDistrict.value,
      addressCity: outcome.result.city || controls.addressCity.value,
      addressUf: outcome.result.uf || controls.addressUf.value,
    });

    // O ViaCEP nunca traz número nem complemento, e o número agora é obrigatório: sem
    // levar o usuário até lá, ele veria quatro campos se preencherem e não saberia o
    // que ainda falta. Só quando está vazio — senão roubaria o foco de quem voltou ao
    // CEP para corrigir um endereço já completo. E o salto fica AGENDADO, não feito:
    // quem o executa é o `(blur)` do CEP (ver `onCepBlur`).
    this.numberFocusPending = !controls.addressNumber.value.trim();

    this.cepStatusMessage.set(this.resolvedAddressAnnouncement());
  }

  /**
   * O que a região `aria-live` diz depois de um preenchimento bem-sucedido.
   *
   * Quatro campos mudam de valor de uma vez sem que o foco saia do lugar: sem dizer o
   * que entrou neles, quem usa leitor de tela só percebe a mudança se sair varrendo o
   * formulário de novo. O aviso termina no que FALTA, porque é a única coisa que o
   * ViaCEP nunca traz e que o bloco exige.
   */
  private resolvedAddressAnnouncement(): string {
    const controls = this.contactGroup.controls;
    const parts = [
      controls.addressStreet.value,
      controls.addressDistrict.value,
      controls.addressCity.value,
      controls.addressUf.value,
    ]
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    const address =
      parts.length > 0 ? `Endereço preenchido: ${parts.join(', ')}.` : 'Endereço preenchido.';
    return this.numberFocusPending ? `${address} Falta o número.` : address;
  }

  /**
   * Foco direto, sem `afterNextRender`: no `(blur)` nada re-renderiza — o campo Número
   * já está no DOM desde que o formulário nasceu. Esperar o próximo render só adiaria
   * o salto para depois de o navegador já ter decidido para onde levar o foco.
   */
  private focusAddressNumber(): void {
    this.host.nativeElement.querySelector<HTMLElement>('#empresa-numero')?.focus();
  }

  private focusCep(): void {
    this.host.nativeElement.querySelector<HTMLElement>('#empresa-cep')?.focus();
  }

  /**
   * `activeElement` lido pelo `ownerDocument` do próprio host, não pelo `document`
   * global: o componente nunca precisa saber que existe um `window` (SSR).
   */
  private retryButtonHasFocus(): boolean {
    const host = this.host.nativeElement;
    const button = host.querySelector('[data-cep-retry]');
    return button !== null && host.ownerDocument.activeElement === button;
  }

  protected save(): void {
    const snapshot = this.snapshot();
    if (!snapshot || this.saving()) return;

    clearServerErrors(this.form);
    this.saveError.set(null);

    if (this.form.invalid) {
      this.saveAttempted.set(true);
      this.form.markAllAsTouched();
      this.revealFirstError();
      return;
    }

    this.saveAttempted.set(false);
    this.saving.set(true);
    this.service.save(snapshot.name, this.buildPayload()).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.adopt(updated);
        this.notifications.success('Dados de contato atualizados.');
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const result = this.apiErrors.handleForm(err, this.form, SAVE_FALLBACK);
        this.saveError.set(ownedByInterceptor(err.status) ? null : result.formMessage);
        this.revealFirstError();
      },
    });
  }

  /**
   * Monta o bloco COMPLETO.
   *
   * As onze chaves estão escritas uma a uma de propósito: o `PUT` substitui o
   * bloco inteiro, então uma chave omitida aqui não vira "não mexe neste campo",
   * vira `NULL` no banco — apaga o que o usuário tinha salvo antes. O `''` de um
   * campo vazio é intencional e é o único jeito de limpar um valor.
   */
  private buildPayload(): CompanyContactPayload {
    const raw = this.form.getRawValue().contact;
    return {
      phone: clean(raw.phone),
      email: clean(raw.email),
      addressStreet: clean(raw.addressStreet),
      addressNumber: clean(raw.addressNumber),
      addressComplement: clean(raw.addressComplement),
      addressDistrict: clean(raw.addressDistrict),
      addressCep: clean(raw.addressCep),
      addressCity: clean(raw.addressCity),
      // Maiúsculas no cliente também: o backend faz o mesmo, mas assim o que
      // viaja é exatamente o que fica gravado.
      addressUf: clean(raw.addressUf).toUpperCase(),
      representativeName: clean(raw.representativeName),
      representativeRole: clean(raw.representativeRole),
    };
  }

  /**
   * Adota a resposta do servidor como verdade.
   *
   * Só é chamado com uma resposta em mãos (carregamento inicial ou salvamento),
   * nunca em paralelo com a digitação: enquanto o GET está em voo o formulário
   * não está na tela.
   */
  private adopt(snapshot: CompanyContactSnapshot): void {
    this.snapshot.set(snapshot);
    const contact = snapshot.contact;

    this.contactGroup.setValue({
      // Re-mascarado na hidratação para renderizar igual ao que o usuário digitaria.
      phone: maskPhone(contact.phone),
      email: contact.email ?? '',
      addressStreet: contact.addressStreet ?? '',
      addressNumber: contact.addressNumber ?? '',
      addressComplement: contact.addressComplement ?? '',
      addressDistrict: contact.addressDistrict ?? '',
      addressCep: maskCep(contact.addressCep),
      addressCity: contact.addressCity ?? '',
      addressUf: contact.addressUf ?? '',
      representativeName: contact.representativeName ?? '',
      representativeRole: contact.representativeRole ?? '',
    });
    this.form.markAsPristine();

    // O CEP que veio do servidor conta como "já consultado": ele foi salvo junto com o
    // endereço, e uma busca aqui só serviria para sobrescrever o logradouro gravado.
    this.lastCepQueried = normalizeCep(contact.addressCep);
    this.cepInFlight = '';
    this.numberFocusPending = false;
    this.cepRetryFromButton = false;
    this.cepLoading.set(false);
    this.cepLookupError.set(null);
    this.cepStatusMessage.set('');
    this.saveAttempted.set(false);

    this.neverFilled.set(
      Object.values(contact).every((value) => value === null || value === ''),
    );
  }

  /**
   * Traz a primeira falha para a tela. O botão fica no fim de um formulário
   * longo: no celular, um salvamento recusado ficaria inteiramente fora de vista.
   * Campo inválido tem prioridade — focá-lo rola até ele e faz o leitor de tela
   * anunciar a mensagem `role="alert"` que o `app-form-field` monta.
   */
  private revealFirstError(): void {
    afterNextRender(
      () => {
        const invalid = this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (invalid) {
          invalid.focus();
          centre(invalid);
          return;
        }
        // Sem campo inválido focável, sobra o que estiver no rodapé: o erro do
        // servidor ou o banner de bloco incompleto. O seletor cobre os dois porque
        // um envio recusado tem que terminar em ALGUMA coisa visível.
        centre(
          this.host.nativeElement.querySelector<HTMLElement>(
            '[data-save-error], [data-block-error]',
          ),
        );
      },
      { injector: this.injector },
    );
  }
}
