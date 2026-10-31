import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Format email tidak valid' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Kata sandi wajib diisi' })
  @MaxLength(200)
  password!: string;
}
