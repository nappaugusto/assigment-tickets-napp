export interface User {
  id: number;
  name: string;
  username: string;
  email: string | null;
  password: string;
  role: 'admin' | 'user';
  google_id: string | null;
  created_at: string;
}

export type PublicUser = Omit<User, 'password'>;
