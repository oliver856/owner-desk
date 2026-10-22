import { cookies } from 'next/headers';

export async function themeMode(): Promise<'light' | 'dark' | 'system'> {
  const v = (await cookies()).get('theme')?.value;
  return v === 'light' || v === 'dark' ? v : 'system';
}
