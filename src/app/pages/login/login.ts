import { Component } from '@angular/core';
import { DefaultLoginLayout } from '../../components/default-login-layout/default-login-layout';

@Component({
  selector: 'app-login',
  imports: [
    DefaultLoginLayout
  ],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {

}
