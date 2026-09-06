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

  // A campaign cannot be scheduled without a sender, and there is no UI for
  // creating one, so every user gets a default on sign-in. Without this a fresh
  // deployment is unusable: the first Compose fails with "No sender configured".
  await ensureDefaultSender(user.id, user.name, user.email);

  return toPublicUser(user);
}

/**
 * Gives a user a default From address the first time they sign in.
 *
 * Ethereal ignores the From header — it captures everything regardless — so the
 * user's own address is the most recognisable choice, and it makes the Sent
 * table read sensibly. Additional senders can be added directly in the
 * database; the schema, the API's optional `senderId` and the per-sender
 * throttle all support several per user.
 */
async function ensureDefaultSender(userId: string, name: string, email: string): Promise<void> {
  const existing = await prisma.sender.findFirst({ where: { userId } });
  if (existing) return;

  try {
    await prisma.sender.create({
      data: {
        userId,
        name,
        fromEmail: email,
        provider: 'ETHEREAL',
        isDefault: true,
        isVerified: true,
        verifiedAt: new Date(),
      },
    });
  } catch (error) {
    // Two tabs completing sign-in at once both pass the check above; the unique
    // constraint settles it and the loser has nothing left to do.
    if ((error as { code?: unknown }).code !== 'P2002') throw error;
  }
}

export async function findUserById(id: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? toPublicUser(user) : null;
}
