import { DynamicModule, Module } from '@nestjs/common';
import { AUTH_OPTIONS, AuthController, AuthOptions } from './auth.controller';
import { AuthService, LOGIN_THROTTLE } from './auth.service';
import { DEFAULT_LOGIN_THROTTLE, LoginThrottle, LoginThrottleOptions } from './login-throttle.service';

@Module({})
export class AuthModule {
  static forRoot(options: AuthOptions & { loginThrottle?: LoginThrottleOptions }): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: AUTH_OPTIONS, useValue: { cookieSecure: options.cookieSecure } },
        { provide: LOGIN_THROTTLE, useValue: new LoginThrottle(options.loginThrottle ?? DEFAULT_LOGIN_THROTTLE) },
      ],
    };
  }
}
