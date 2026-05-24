import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';

interface FaqItem { q: string; a: string; }

@Component({
  selector: 'app-landing-faq',
  templateUrl: './landing-faq.component.html',
  styleUrls: ['./landing-faq.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingFaqComponent implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly faqs: FaqItem[] = [
    { q: 'O que é o MyCarsHub?', a: 'Um ERP feito exclusivamente para locadoras de veículos. Contratos, cobranças, multas, manutenções e financeiro — tudo num lugar só, sem planilha.' },
    { q: 'Preciso de cartão de crédito pra começar?', a: 'Não. O trial de 14 dias é completo e sem cartão. Você só paga se decidir continuar.' },
    { q: 'O MyCarsHub processa pagamentos?', a: 'Não diretamente. A gente integra com o gateway que você já usa (Pix, boleto, cartão). Emitimos a cobrança e sincronizamos o status por webhook — o recebimento fica no seu PSP.' },
    { q: 'Consigo usar com mais de uma empresa?', a: 'Sim. Você pode ser dono de uma locadora, gestor de outra e motorista de uma terceira — tudo no mesmo login, trocando em 1 clique.' },
    { q: 'Quantos veículos posso cadastrar?', a: 'No trial, até 5. No plano Pro, ilimitado. Enterprise é sob consulta para frotas grandes ou multi-filial.' },
    { q: 'Tem suporte em português?', a: 'Sim. Somos brasileiros, o suporte é em PT-BR e o produto foi desenhado pra realidade de locadoras no Brasil.' },
    { q: 'Posso cancelar a qualquer momento?', a: 'Sim. Sem fidelidade, sem multa. Cancele quando quiser direto na plataforma.' },
  ];

  ngAfterViewInit(): void {
    const obs = new IntersectionObserver(
      (entries) => { for (const e of entries) { if (e.isIntersecting) { e.target.classList.add('revealed'); obs.unobserve(e.target); } } },
      { threshold: 0.15 }
    );
    this.host.nativeElement.querySelectorAll('.reveal').forEach((el: Element) => obs.observe(el));
  }
}
