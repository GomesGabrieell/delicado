import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';

import type { CompositionLine } from '../calculator/repository';
import { readPhoto, releasePhoto } from '../services/localPhoto';

export const statuses = { draft: 'Rascunho', ready: 'Pronto para revisão', archived: 'Arquivado' } as const;
export type Status = keyof typeof statuses;
export type QuoteFields = { title: string; client_id: string | null; event_date: string | null; location: string; decoration: string; payment_terms: string };
export type Quote = QuoteFields & {
  id: string; code: string; status: Status; updated_at: string;
  items: (CompositionLine & { name: string; unit: string | null })[];
};
export type QuoteClient = { id: string; name: string };
export type SavedInputs = {
  lines: { whole?: boolean }[];
  expenses: string[];
  transport: { kind: 'pickup' | 'fixed' | 'distance'; cost?: string; km?: string; rate?: string };
  labor: string;
  profitPercent: string;
  discount: { kind: 'fixed' | 'percent'; value: string };
};
export type Snapshot = {
  totalCost: string; sale: string; profit: string; margin: string | null;
  inputs: SavedInputs; expenseNames: string[];
};
const bucket = 'quote-inspiration';
const columns = 'id,code,status,title,client_id,event_date,location,decoration,payment_terms,updated_at,items';
export const quotePage = 20;
export const historyPage = 20;
export type HistoryEntry = { id: number; action: string; status: Status; happened_at: string };

export function quoteError(error: unknown) {
  if (error instanceof Error) return error.message;
  const code = typeof error === 'object' && error && 'code' in error ? error.code : '';
  if (code === '42501') return 'Acesso negado ou orçamento indisponível para esta operação.';
  if (code === '23505') return 'Já existe um cliente com esse nome.';
  if (code === '23514' || code === '23503') return 'Revise os dados, o estado do orçamento e a composição.';
  if (code === 'PGRST116' || code === '40001') return 'O orçamento mudou desde a abertura. Abra-o novamente.';
  if (code === 'PGRST205' || code === 'PGRST202') return 'A migração de Orçamentos precisa ser aplicada.';
  return 'Não foi possível concluir a operação. Tente novamente.';
}

export async function listQuotes(client: SupabaseClient, company: string, query: string, status: Status | '', offset: number) {
  let request = client.from('quotes').select(columns).eq('company_id', company);
  if (status) request = request.eq('status', status);
  const search = query.trim().replace(/[^\p{L}\p{N} -]/gu, ' ').trim();
  if (search) request = request.or(`title.ilike.*${search}*,code.ilike.*${search}*,location.ilike.*${search}*`);
  const { data, error } = await request.order('updated_at', { ascending: false }).order('id')
    .range(offset, offset + quotePage).returns<Quote[]>();
  if (error) throw error;
  return data;
}

export async function saveQuote(client: SupabaseClient, company: string, fields: Partial<QuoteFields> & { status?: Status }, existing?: Quote) {
  const table = client.from('quotes');
  const request = existing
    ? table.update(fields).eq('company_id', company).eq('id', existing.id).eq('updated_at', existing.updated_at)
    : table.insert({ ...fields, company_id: company });
  const { data, error } = await request.select(columns).single<Quote>();
  if (error) throw error;
  return data;
}

export async function findClients(client: SupabaseClient, company: string, query: string, selected?: string | null) {
  const table = client.from('quote_clients');
  const search = query.trim().replace(/[\\%_*]/g, '\\$&');
  const matches = table.select('id,name').eq('company_id', company).is('archived_at', null)
    .ilike('name', `%${search}%`).order('name').limit(30);
  const [result, chosen] = await Promise.all([
    matches.returns<QuoteClient[]>(),
    selected ? client.from('quote_clients').select('id,name').eq('company_id', company).eq('id', selected).maybeSingle<QuoteClient>() : null,
  ]);
  if (result.error) throw result.error;
  if (chosen?.error) throw chosen.error;
  return chosen?.data && !result.data.some(({ id }) => id === selected) ? [chosen.data, ...result.data] : result.data;
}

export async function createClient(client: SupabaseClient, company: string, name: string) {
  const { data, error } = await client.from('quote_clients').insert({ company_id: company, name })
    .select('id,name').single<QuoteClient>();
  if (error) throw error;
  return data;
}

export async function saveQuoteComposition(client: SupabaseClient, company: string, quote: string, version: string, lines: CompositionLine[], snapshot?: Snapshot) {
  const { error } = await client.rpc('save_quote_composition', {
    p_company: company, p_quote: quote, p_version: version, p_lines: lines, p_snapshot: snapshot ?? null,
  });
  if (error) throw error;
}

export async function createQuoteFromCalculator(client: SupabaseClient, company: string, title: string, lines: CompositionLine[], snapshot?: Snapshot) {
  const { data, error } = await client.rpc('create_quote_from_calculator', {
    p_company: company, p_title: title, p_lines: lines, p_snapshot: snapshot ?? null,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('Não foi possível confirmar a criação do orçamento.');
  return data;
}

export async function duplicateQuote(client: SupabaseClient, company: string, id: string) {
  const { data, error } = await client.rpc('duplicate_quote', { p_company: company, p_quote: id });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('A cópia foi solicitada. Atualize a lista de orçamentos.');
  return data;
}

export async function listQuoteHistory(client: SupabaseClient, company: string, id: string, before?: number) {
  let query = client.from('quote_history').select('id,action,status,happened_at').eq('company_id', company)
    .eq('quote_id', id);
  if (before !== undefined) query = query.lt('id', before);
  const { data, error } = await query.order('id', { ascending: false }).limit(historyPage + 1).returns<HistoryEntry[]>();
  if (error) throw error;
  return data;
}

export async function loadQuote(client: SupabaseClient, company: string, id: string, financial: boolean) {
  const [quote, costs] = await Promise.all([
    client.from('quotes').select(columns).eq('company_id', company).eq('id', id).single<Quote>(),
    financial ? client.from('quote_financials').select('snapshot').eq('company_id', company)
      .eq('quote_id', id).maybeSingle<{ snapshot: Snapshot }>() : null,
  ]);
  if (quote.error) throw quote.error;
  if (costs?.error) throw costs.error;
  return { quote: quote.data, snapshot: costs?.data?.snapshot };
}

export async function loadQuoteDetails(client: SupabaseClient, company: string, id: string, financial: boolean) {
  const [data, history, images] = await Promise.all([
    loadQuote(client, company, id, financial),
    listQuoteHistory(client, company, id),
    client.from('quote_images').select('path').eq('company_id', company).eq('quote_id', id).returns<{ path: string }[]>(),
  ]);
  if (images.error) throw images.error;
  return { ...data, history, images: images.data };
}

export async function imageUrl(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function uploadInspiration(client: SupabaseClient, company: string, quote: string) {
  const picked = await launchImageLibraryAsync({ mediaTypes: ['images'] });
  if (picked.canceled) return false;
  const asset = picked.assets[0];
  if (asset.fileSize && asset.fileSize > 25 * 1024 * 1024) throw new Error('Selecione uma foto original de até 25 MB.');
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > 1600) context.resize(asset.width >= asset.height ? { width: 1600 } : { height: 1600 });
  const rendered = await context.renderAsync();
  const photo = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const path = `${company}/${quote}/${randomUUID()}.jpg`;
  const storage = client.storage.from(bucket);
  try {
    const uploaded = await storage.upload(path, await readPhoto(photo.uri), { contentType: 'image/jpeg', upsert: false });
    if (uploaded.error) throw uploaded.error;
    const { error } = await client.rpc('attach_quote_image', { p_company: company, p_quote: quote, p_path: path });
    if (error) {
      await storage.remove([path]).catch(() => undefined);
      throw error;
    }
    return true;
  } finally {
    releasePhoto(photo.uri);
  }
}
