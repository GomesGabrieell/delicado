import { File } from 'expo-file-system';

export async function readPhoto(uri: string) {
  const file = new File(uri);
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('A imagem preparada precisa ter até 5 MB.');
  return file.arrayBuffer();
}

export function releasePhoto(uri: string) {
  try { new File(uri).delete(); } catch { /* O sistema pode ter limpado o cache. */ }
}
