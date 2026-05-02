import { Component, Input } from "@angular/core";

@Component({
    selector: 'app-default-page-layout',
    templateUrl: './default-page-layout.html',
    styleUrl: './default-page-layout.css'
})
export class DefaultPageLayout {
    @Input() title: string = ""
    @Input() description: string = ""
}