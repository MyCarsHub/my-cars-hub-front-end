import { Component, Input } from "@angular/core";
import { PastDueBanner } from "../../past-due-banner/past-due-banner";

@Component({
    selector: 'app-default-page-layout',
    imports: [PastDueBanner],
    templateUrl: './default-page-layout.html',
    styleUrl: './default-page-layout.css'
})
export class DefaultPageLayout {
    @Input() title: string = ""
    @Input() description: string = ""
}