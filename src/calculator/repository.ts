import type { SupabaseClient } from '@supabase/supabase-js';

import type { Kind } from '../catalog/model';
import { listCatalogFinancials } from '../catalog/repository';

export type CompositionLine = { id: string; quantity: string };
export type SavedDraft = { id: string; name: string; lines: CompositionLine[]; updated_at: string };
export type Product = { id: string; kind: Kind; name: string; brand: string | null; size: string | null;
  package_quantity: number | null; quantity: number | null; unit: string | null;
  ownership: 'owned' | 'rented' | null; archived_at: string | null };

const productColumns = 'id,kind,name,brand,size,package_quantity,quantity,unit,ownership,archived_at';
export const calculatorPageSize = 20;

export async function searchProducts(client: SupabaseClient, companyId: string, kind: Kind, text: string, offset: number) {
  let query = client.from('catalog_items').select(productColumns)
    .eq('company_id', companyId).eq('kind', kind).is('archived_at', null);
  const search = text.trim().replace(/[\\%_*]/g, '\\$&');
  if (search) query = query.ilike('search_text', `%${search}%`);
  const { data, error } = await query.order('name').order('id').range(offset, offset + calculatorPageSize).returns<Product[]>();
  if (error) throw error;
  return data;
}

export async function loadProducts(client: SupabaseClient, companyId: string, ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await client.from('catalog_items').select(productColumns)
    .eq('company_id', companyId).in('id', ids).returns<Product[]>();
  if (error) throw error;
  return data;
}

export async function listDrafts(client: SupabaseClient, companyId: string, offset: number) {
  const { data, error } = await client.from('calculator_drafts').select('id,name,lines,updated_at')
    .eq('company_id', companyId).order('updated_at', { ascending: false }).order('id')
    .range(offset, offset + calculatorPageSize).returns<SavedDraft[]>();
  if (error) throw error;
  return data;
}

export async function saveDraft(client: SupabaseClient, companyId: string, name: string, lines: CompositionLine[], draft?: SavedDraft) {
  const table = client.from('calculator_drafts');
  const query = draft
    ? table.update({ name, lines }).eq('company_id', companyId).eq('id', draft.id).eq('updated_at', draft.updated_at)
    : table.insert({ company_id: companyId, name, lines });
  const { data, error } = await query.select('id,name,lines,updated_at').single<SavedDraft>();
  if (error) throw error;
  return data;
}

export async function loadDefault(client: SupabaseClient, companyId: string) {
  const { data, error } = await client.from('calculator_defaults').select('profit_percent')
    .eq('company_id', companyId).maybeSingle<{ profit_percent: number }>();
  if (error) throw error;
  return data ? String(data.profit_percent).replace('.', ',') : '';
}

export async function saveDefault(client: SupabaseClient, companyId: string, value: string) {
  const { error } = await client.rpc('set_calculator_default', {
    p_company_id: companyId, p_profit_percent: value.replace(',', '.'),
  });
  if (error) throw error;
}

export async function loadPrices(client: SupabaseClient, companyId: string, ids: string[]) {
  return ids.length ? listCatalogFinancials(client, companyId, ids) : new Map<string, never>();
}
