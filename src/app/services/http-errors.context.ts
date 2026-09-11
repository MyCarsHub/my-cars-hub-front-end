import { HttpContextToken } from '@angular/common/http';

/**
 * Marca uma requisição cujo fracasso NÃO é assunto do usuário.
 *
 * O `errorInterceptor` é dono de uma única classe de feedback — o toast para o
 * que a tela não consegue explicar. Isso vale para tudo que o usuário PEDIU:
 * salvar, listar, pagar. Não vale para o que o aplicativo manda por conta
 * própria depois que a interação já terminou, do tipo "registre que este
 * usuário viu o tour": ali a resposta não muda nada na tela, e um "Sem conexão
 * com o servidor." só apareceria para acusar de um erro uma pessoa que não
 * pediu nada.
 *
 * Marcar a requisição desliga TODO o tratamento genérico dela — toast, rede de
 * segurança de 4xx e o desvio de sessão do 401. É de propósito: quem marca
 * assume o erro inteiro (tipicamente com um log e nada mais). Use só em chamada
 * `fire-and-forget`, nunca numa cujo resultado o usuário está esperando.
 *
 * Mora num arquivo sem dependências pelo mesmo motivo de
 * `impersonation.context.ts`: o interceptor precisa do token e importar o
 * serviço que o usa fecharia um ciclo (serviço → HttpClient → interceptor →
 * serviço).
 */
export const SILENT_HTTP_ERRORS = new HttpContextToken<boolean>(() => false);

/**
 * Marca uma requisição cuja FALHA DE NEGÓCIO é assunto da tela — mas cuja
 * SESSÃO continua sendo assunto do interceptor.
 *
 * Diferença para `SILENT_HTTP_ERRORS`: aquele desliga TUDO (inclusive o
 * desvio de sessão do 401) e por isso só serve para fire-and-forget. Este
 * desliga apenas o feedback genérico — toast de status 0/403/5xx e a rede de
 * segurança de 4xx — enquanto 401/token expirado seguem limpando a sessão e
 * redirecionando para /login. Use quando o usuário ESTÁ esperando o
 * resultado e a tela tem tradução própria para cada status (ex.: o contrato
 * do plate-lookup, onde 501 é o estado normal de produção e 503 tem nota
 * discreta), mas uma sessão vencida no meio do formulário ainda precisa do
 * caminho padrão.
 */
export const OWNED_HTTP_ERRORS = new HttpContextToken<boolean>(() => false);
