import { Component, ChangeDetectionStrategy, input } from '@angular/core';

@Component({
  selector: 'app-constructor-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './constructor-page.html',
  styleUrl: './constructor-page.css',
})
export class ConstructorPage {
  pageTitle = input<string>('Página em construção');
}
