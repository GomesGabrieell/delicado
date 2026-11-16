export const clientFields = ['document', 'whatsapp', 'email', 'address', 'notes'] as const;
export type PrivateFields = Record<typeof clientFields[number], string | null>;
export type ClientFields = PrivateFields & { name: string };
export type Client = { id: string; name: string; archived_at: string | null; updated_at: string };

export function normalizeDocument(value: string) {
  return value.trim().toUpperCase().replace(/[.\s/-]/g, '');
}

export function validDocument(value: string) {
  const cpf = /^\d{11}$/.test(value);
  if ((!cpf && !/^[A-Z0-9]{12}\d{2}$/.test(value)) || /^(.)\1+$/.test(value)) return false;
  let base = value.slice(0, -2);
  const weightSets = cpf ? [[10, 9, 8, 7, 6, 5, 4, 3, 2], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]]
    : [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]];
  for (const weights of weightSets) {
    const remainder = weights.reduce((sum, weight, index) => sum + weight * (base.charCodeAt(index) - 48), 0) % 11;
    base += remainder < 2 ? '0' : String(11 - remainder);
  }
  return base === value;
}

export function validateClient(fields: ClientFields): ClientFields {
  const name = fields.name.trim();
  const document = normalizeDocument(fields.document ?? '');
  const whatsapp = (fields.whatsapp ?? '').trim().replace(/[\s().-]/g, '');
  const email = (fields.email ?? '').trim();
  const address = (fields.address ?? '').trim();
  const notes = (fields.notes ?? '').trim();
  if (!name || name.length > 120) throw new Error('Informe um nome de até 120 caracteres.');
  if (fields.document?.trim() && !validDocument(document)) throw new Error('Informe um CPF ou CNPJ válido.');
  if (fields.whatsapp?.trim() && !/^\+?\d{10,15}$/.test(whatsapp)) throw new Error('Informe o WhatsApp com DDD e, se necessário, código do país.');
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Informe um e-mail válido.');
  if (address.length > 500 || notes.length > 2000) throw new Error('Revise o tamanho do endereço ou das observações.');
  return { name, document: document || null, whatsapp: whatsapp || null, email: email || null,
    address: address || null, notes: notes || null };
}
