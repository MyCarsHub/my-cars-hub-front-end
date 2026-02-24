import { Routes } from '@angular/router';
import { Login } from './pages/login/login';
import { Signup } from './pages/signup/signup';
import { AccountSteps } from './pages/account-steps/account-steps';
import { AuthGuard } from './services/auth-guard';

export const routes: Routes = [
    {
        path: 'login',
        component: Login
    },
    {
        path: 'signup',
        component: Signup
    },
    {
        path: 'account-steps',
        component: AccountSteps,
        canActivate: [AuthGuard]
    }
];
