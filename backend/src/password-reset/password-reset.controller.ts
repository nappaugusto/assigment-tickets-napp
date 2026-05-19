import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  BadRequestException,
} from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';
import { ForgotPasswordDto, ResetPasswordDto } from './password-reset.dto';

@Controller('auth')
export class PasswordResetController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.passwordResetService.requestReset(dto.username);
    return {
      success: true,
      message:
        'Se o email existe, você receberá um link para redefinir a senha.',
    };
  }

  @Get('reset-password/:token')
  async validateToken(@Param('token') token: string) {
    const { valid } = await this.passwordResetService.validateToken(token);
    return { valid };
  }

  @Post('reset-password/:token')
  async resetPassword(
    @Param('token') token: string,
    @Body() dto: ResetPasswordDto,
  ) {
    if (dto.password !== dto.confirm_password) {
      throw new BadRequestException('As senhas não coincidem.');
    }
    const result = await this.passwordResetService.resetPassword(
      token,
      dto.password,
    );
    if (!result.success) {
      throw new BadRequestException(result.error);
    }
    return { success: true, message: 'Senha redefinida com sucesso!' };
  }
}
