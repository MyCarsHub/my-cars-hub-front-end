import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-default-login-layout',
  imports: [],
  templateUrl: './default-login-layout.html',
  styleUrl: './default-login-layout.css',
})
export class DefaultLoginLayout {
  @Input() description: string = '';
  @Input() googleBtnText: string = '';
  @Input() primaryBtnText: string = '';
  @Input() navigateText: string = '';
  @Input() navigateBtnText: string = '';
  @Input() disablePrimaryBtn: boolean = true;
  @Output("submit") onSubmit = new EventEmitter(); 
  @Output("navigate") onNavigate = new EventEmitter();
  @Output("summitGoogle") onSummitGoogle = new EventEmitter();

  summitGoogle() {
    this.onSummitGoogle.emit();
  }

  submit() {
    this.onSubmit.emit();
  }

  navigate() {
    this.onNavigate.emit();
  }
}
