import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-oauth-success',
  imports: [],
  templateUrl: './oauth-success.html',
  styleUrls: ['./oauth-success.css'],
})
export class OauthSuccess {
constructor(
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {

    const token = this.route.snapshot.queryParamMap.get('token');
    console.log("TOKEN:", token);

    if (token) {
      sessionStorage.setItem('token', token);
      this.router.navigate(['/account-steps']);
    } else {
      this.router.navigate(['/login']);
    }

  }
}
