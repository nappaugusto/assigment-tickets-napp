import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { User, PublicUser } from '../users/user.entity';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async validateUser(username: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByLoginIdentifier(username);
    if (!user) return null;
    const valid = await this.usersService.verifyPassword(user, password);
    return valid ? user : null;
  }

  async register(
    name: string,
    username: string,
    password: string,
  ): Promise<{ success: boolean; error?: string; user?: PublicUser }> {
    if (!name || !username || !password) {
      return { success: false, error: 'Todos os campos são obrigatórios.' };
    }
    if (username.length < 3) {
      return { success: false, error: 'Usuário deve ter no mínimo 3 caracteres.' };
    }
    if (password.length < 6) {
      return { success: false, error: 'Senha deve ter no mínimo 6 caracteres.' };
    }
    if (await this.usersService.exists(username)) {
      return { success: false, error: 'Usuário já existe.' };
    }
    const user = await this.usersService.create(name, username, password);
    return { success: true, user };
  }

  toPublic(user: User): { id: number; name: string } {
    return { id: user.id, name: user.name };
  }
}
