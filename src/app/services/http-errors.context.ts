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
