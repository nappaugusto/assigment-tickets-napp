export interface User {
  id: number;
  name: string;
  username: string;
  password: string;
  created_at: string;
}

export type PublicUser = Omit<User, 'password'>;
