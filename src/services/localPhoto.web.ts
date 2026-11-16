export async function readPhoto(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Não foi possível abrir a imagem selecionada.');
  const file = await response.blob();
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('A imagem preparada precisa ter até 5 MB.');
  return file.arrayBuffer();
}

export function releasePhoto(uri: string) {
  if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
}
