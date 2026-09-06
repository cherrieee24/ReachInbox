/** Shape of a user as returned to the browser. Never includes internal fields. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  role: 'MEMBER' | 'ADMIN';
  createdAt: string;
  updatedAt: string;
}

/** Envelope every endpoint returns. */
export interface ApiResponse<TData> {
  success: boolean;
  data: TData;
  message?: string;
}
