import { db } from './index.ts';
import { users } from './schema.ts';
import { eq, or } from 'drizzle-orm';
import { UserAccount } from '../types.ts';

export function mapDbToUser(row: any): UserAccount {
  const permissions = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions;
  return {
    id: String(row.uid || row.id),
    username: row.email ? row.email.split('@')[0] : `user-${row.id}`,
    name: row.name || 'User',
    email: row.email,
    role: (row.role || 'focal') as any,
    assignedBarangay: row.assignedBarangay || undefined,
    barangay_id: row.assignedBarangay ? `brgy-${row.assignedBarangay.toLowerCase().replace(/\s+/g, '-')}` : undefined,
    phone: row.phone || '',
    contactNo: row.phone || '',
    authUserId: row.authUserId || undefined,
    active: row.active ?? row.isActive ?? row.status === 'active',
    status: row.status || (row.active === false ? 'inactive' : 'active'),
    permissions: Array.isArray(permissions) ? permissions : [],
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
  };
}

export async function getAllUsers(): Promise<UserAccount[]> {
  const rows = await db.select().from(users);
  return rows.map(mapDbToUser);
}

export async function getUserByUsernameOrEmail(identifier: string): Promise<UserAccount | null> {
  try {
    const rows = await db
      .select()
      .from(users)
      .where(or(eq(users.email, identifier), eq(users.uid, identifier)))
      .limit(1);

    if (rows.length > 0) {
      return mapDbToUser(rows[0]);
    }
    // Also check if identifier matches prefix of email
    const all = await getAllUsers();
    return all.find(u => u.username === identifier || u.email.toLowerCase() === identifier.toLowerCase()) || null;
  } catch (err) {
    console.error('Database query error for getUserByUsernameOrEmail:', err);
    return null;
  }
}

export async function getUserByAuthUserId(authUserId: string): Promise<UserAccount | null> {
  const rows = await db.select().from(users).where(eq(users.authUserId, authUserId)).limit(1);
  return rows[0] ? mapDbToUser(rows[0]) : null;
}

export async function upsertUser(user: Partial<UserAccount>): Promise<UserAccount> {
  try {
    const uid = user.id || `usr-${Date.now()}`;
    const email = user.email || `${user.username || 'user'}@hinunangan.da.gov.ph`;
    
    const values = {
      id: user.authUserId || user.id,
      uid,
      email,
      name: user.name || user.fullName || user.username || 'User',
      role: user.role || 'focal',
      assignedBarangay: user.assignedBarangay || null,
      phone: user.phone || null,
      authUserId: user.authUserId || null,
      active: user.active ?? true,
      status: user.status || (user.active === false ? 'inactive' : 'active'),
      permissions: user.permissions || [],
    };

    const result = await db
      .insert(users)
      .values(values)
      .onConflictDoUpdate({
        target: users.uid,
        set: values,
      })
      .returning();

    return mapDbToUser(result[0]);
  } catch (err) {
    console.error('Database query failed for upsertUser:', err);
    throw new Error('Failed to save user account to database.');
  }
}

export async function deleteUserByUid(uid: string): Promise<boolean> {
  try {
    await db.delete(users).where(eq(users.uid, uid));
    return true;
  } catch (err) {
    console.error('Database error in deleteUserByUid:', err);
    throw new Error('Failed to delete user account from database.');
  }
}
