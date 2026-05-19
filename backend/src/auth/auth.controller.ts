import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
  HttpCode,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LocalAuthGuard, SessionGuard } from './auth.guard';
import { RegisterDto } from './auth.dto';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Get('me')
  me(@Req() req: Request) {
    if ((req as any).isAuthenticated()) {
      const user = (req as any).user as User;
      return { authenticated: true, user: this.authService.toPublic(user) };
    }
    return { authenticated: false, user: null };
  }

  private async saveSession(req: Request): Promise<void> {
    const session = (req as any).session;
    if (!session) return;

    await new Promise<void>((resolve, reject) => {
      session.save((err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(200)
  async login(@Req() req: Request) {
    const user = (req as any).user as User;

    await new Promise<void>((resolve, reject) => {
      (req as any).logIn(user, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await this.saveSession(req);
    return { success: true, user: this.authService.toPublic(user) };
  }

  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    if (dto.password !== dto.confirm_password) {
      throw new BadRequestException('Senhas não coincidem.');
    }

    const result = await this.authService.register(
      dto.name,
      dto.username,
      dto.password,
    );

    if (!result.success || !result.user) {
      throw new BadRequestException(result.error);
    }

    const fullUser = await this.usersService.findByUsername(dto.username);
    if (!fullUser) {
      throw new BadRequestException('Erro ao criar usuário.');
    }

    await new Promise<void>((resolve, reject) => {
      (req as any).logIn(fullUser, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await this.saveSession(req);

    return {
      success: true,
      user: { id: result.user.id, name: result.user.name },
    };
  }

  @UseGuards(SessionGuard)
  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request, @Res({ passthrough: true }) _res: Response) {
    return new Promise<{ success: boolean }>((resolve, reject) => {
      (req as any).logout((err: unknown) => {
        if (err) return reject(new UnauthorizedException());
        resolve({ success: true });
      });
    });
  }

  @Get('logout')
  logoutGet(@Req() req: Request) {
    return new Promise<{ success: boolean }>((resolve, reject) => {
      (req as any).logout((err: unknown) => {
        if (err) return reject(new UnauthorizedException());
        resolve({ success: true });
      });
    });
  }
}
