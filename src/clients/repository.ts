import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeDocument, type Client, type ClientFields, type PrivateFields } from './model';

const columns = 'id,name,archived_at,updated_at';
export const clientPage = 20;
type Audit = { id: number; action: 'created' | 'edited' | 'archived' | 'restored'; changed_fields: string[]; happened_at: string };
export type ClientQuote = { id: string; code: string; title: string; event_date: string | null; status: 'draft' | 'ready' | 'archived' };

export function clientError(error: unknown) {
  if (error instanceof Error) return error.message;
  const code = typeof error === 'object' && error && 'code' in error ? error.code : '';
  if (code === '23505') return 'Já existe um cliente com esse nome ou documento. Confira também os arquivados.';
  if (code === '40001') return 'O cadastro mudou. Reabra o cliente antes de salvar.';
  if (code === '42501') return 'Sua conta não tem permissão para esta operação.';
  if (code === '23514') return 'Confira os dados do cliente.';
  if (code === 'PGRST202' || code === '42703') return 'A migração de Clientes precisa ser aplicada.';
  return 'Não foi possível concluir a operação. Tente novamente.';
}

export async function listClients(client: SupabaseClient, company: string, search: string, byDocument: boolean, archived: boolean, offset: number) {
  if (byDocument && search.trim()) {
    const { data, error } = await client.rpc('search_clients_by_document', {
      p_company: company, p_search: normalizeDocument(search), p_archived: archived, p_offset: offset,
    });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Não foi possível consultar os documentos.');
    return data as Client[];
  }
  let request = client.from('quote_clients').select(columns).eq('company_id', company);
  request = archived ? request.not('archived_at', 'is', null) : request.is('archived_at', null);
  if (search.trim()) request = request.ilike('name', `%${search.trim().replace(/[\\%_*]/g, '\\$&')}%`);
  const { data, error } = await request.order('name').order('id').range(offset, offset + clientPage).returns<Client[]>();
  if (error) throw error;
  return data;
}

export async function loadClient(client: SupabaseClient, company: string, id: string, manage: boolean) {
  const [row, personal] = await Promise.all([
    client.from('quote_clients').select(columns).eq('company_id', company).eq('id', id).single<Client>(),
    manage ? client.rpc('client_details', { p_company: company, p_client: id }) : null,
  ]);
  if (row.error) throw row.error;
  if (personal?.error) throw personal.error;
  if (personal && (!Array.isArray(personal.data) || !personal.data[0])) throw new Error('Dados do cliente indisponíveis.');
  return { row: row.data, fields: personal ? (personal.data as PrivateFields[])[0] : null };
}

export async function saveClient(client: SupabaseClient, company: string, fields: ClientFields, existing?: Client) {
  const { data, error } = await client.rpc('save_client', {
    p_company: company, p_client: existing?.id ?? null, p_version: existing?.updated_at ?? null,
    p_name: fields.name, p_document: fields.document, p_whatsapp: fields.whatsapp,
    p_email: fields.email, p_address: fields.address, p_notes: fields.notes,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('Não foi possível confirmar o cadastro.');
  return data;
}

export async function archiveClient(client: SupabaseClient, company: string, row: Client) {
  const { error } = await client.rpc('set_client_archived', {
    p_company: company, p_client: row.id, p_version: row.updated_at, p_archived: !row.archived_at,
  });
  if (error) throw error;
}

export async function clientQuotes(client: SupabaseClient, company: string, id: string, offset: number) {
  const { data, error } = await client.from('quotes').select('id,code,title,event_date,status')
    .eq('company_id', company).eq('client_id', id).order('created_at', { ascending: false }).order('id')
    .range(offset, offset + clientPage).returns<ClientQuote[]>();
  if (error) throw error;
  return data;
}

export async function clientAudit(client: SupabaseClient, company: string, id: string, before?: number) {
  let request = client.from('client_audit').select('id,action,changed_fields,happened_at')
    .eq('company_id', company).eq('client_id', id);
  if (before !== undefined) request = request.lt('id', before);
  const { data, error } = await request.order('id', { ascending: false }).limit(clientPage + 1).returns<Audit[]>();
  if (error) throw error;
  return data;
}
