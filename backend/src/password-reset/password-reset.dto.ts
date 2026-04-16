import { IsString } from 'class-validator';

export class ForgotPasswordDto {
  @IsString()
  username: string;
}

export class ResetPasswordDto {
  @IsString()
  password: string;

  @IsString()
  confirm_password: string;
}
