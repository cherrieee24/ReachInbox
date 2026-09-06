import { adminEmails } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import type { GoogleProfile } from '../integrations/google.js';
import type { PublicUser } from '../types/auth.js';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  role: 'MEMBER' | 'ADMIN';
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/**
 * Finds the user behind a Google account, creating them on first sign-in and
 * refreshing the profile fields Google owns on every subsequent one.
 */
export async function findOrCreateUserFromGoogle(profile: GoogleProfile): Promise<PublicUser> {
  // ADMIN_EMAILS only ever promotes; it never demotes a role set in the
  // database, so removing an address from the list is not a silent revoke.
  const isBootstrapAdmin = adminEmails().includes(profile.email.toLowerCase());
  const roleUpdate = isBootstrapAdmin ? { role: 'ADMIN' as const } : {};

  const user = await prisma.user.upsert({
    where: { googleId: profile.googleId },
    create: {
      googleId: profile.googleId,
      email: profile.email,
      name: profile.name,
      avatar: profile.avatar,
      ...roleUpdate,
    },
    update: {
      email: profile.email,
      name: profile.name,
      avatar: profile.avatar,
      ...roleUpdate,
    },
  });

  return toPublicUser(user);
}

export async function findUserById(id: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? toPublicUser(user) : null;
}
