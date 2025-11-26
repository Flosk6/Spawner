import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';
import { User } from '../../../entities/user.entity';
import { AuthService } from '../auth.service';

@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(private authService: AuthService) {
    super();
  }

  serializeUser(user: User, done: (err: Error, user: { id: number }) => void) {
    done(null, { id: user.id });
  }

  async deserializeUser(
    payload: { id: number },
    done: (err: Error, user: User) => void,
  ) {
    try {
      const user = await this.authService.findUserById(payload.id);
      done(null, user);
    } catch (error) {
      console.error('Session deserialize error:', error);
      done(error, null);
    }
  }
}
