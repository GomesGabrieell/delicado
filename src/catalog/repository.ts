import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';
import { readPhoto } from '../services/localPhoto';

import type { Category, Company, Item, Kind, Ownership, Payload } from './model';

const bucket = 'catalog-images';
export const pageSize = 25;

export function catalogError(error: unknown): string {
  if (error instanceof Error && !('code' in error) && !('status' in error)) return error.message;
  const code = typeof error === 'object' && error && 'code' in error ? error.code : null;
  switch (code) {
    case '42P01':
    case 'PGRST205':
    case 'PGRST202':
      return 'O banco do Catálogo ainda precisa ser configurado.';
    case '42501':
    case 'PGRST116':
      return 'Você perdeu o acesso ou o registro não está mais disponível. Atualize a tela.';
    case '23505':
      return 'Já existe um cadastro com esse identificador ou nome nesta categoria.';
    case '23503':
    case '23514':
      return 'Revise os dados e a categoria selecionada.';
    default:
      return 'Não foi possível concluir a operação. Verifique a conexão e tente novamente.';
  }
}

export async function listCompanies(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from('company_members')
    .select('role, company:companies!inner(id, name)').eq('user_id', userId).eq('status', 'active')
    .overrideTypes<{ role: Company['role']; company: Pick<Company, 'id' | 'name'> }[], { merge: false }>();
  if (error) throw error;
  return data.map(({ company, role }) => ({ ...company, role })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function createCompany(client: SupabaseClient, name: string) {
  const { data, error } = await client.rpc('create_company', { p_name: name });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('Não foi possível confirmar a criação da empresa.');
  return data;
}

export async function listCategories(client: SupabaseClient, companyId: string, kind: Kind) {
  if (kind === 'balloon') return [];
  const { data, error } = await client.from('catalog_categories').select('id, name, kind')
    .eq('company_id', companyId).eq('kind', kind).order('name').returns<Category[]>();
  if (error) throw error;
  return data;
}

export async function createCategory(client: SupabaseClient, companyId: string, kind: Exclude<Kind, 'balloon'>, name: string) {
  const { data, error } = await client.from('catalog_categories').insert({ company_id: companyId, kind, name })
    .select('id, name, kind').single<Category>();
  if (error) throw error;
  return data;
}

export async function listItems(client: SupabaseClient, options: {
  companyId: string; kind: Kind; search: string; archived: boolean; categoryId: string;
  ownership: Ownership | ''; sort: 'name' | 'recent'; offset: number; financial?: boolean;
}) {
  const { companyId, kind, search, archived, categoryId, ownership, sort, offset } = options;
  let query = client.from('catalog_items').select(
    'id, kind, name, category_id, brand, size, balloon_type, package_quantity, ownership, quantity, unit, photo_path, archived_at',
  ).eq('company_id', companyId).eq('kind', kind);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (ownership) query = query.eq('ownership', ownership);
  if (search.trim()) {
    const pattern = search.trim().replace(/[\\%_*]/g, '\\$&');
    query = query.ilike('search_text', `%${pattern}%`);
  }
  const { data, error } = await query.order(sort === 'name' ? 'name' : 'created_at', { ascending: sort === 'name' })
    .order('id').range(offset, offset + pageSize).returns<Omit<Item, keyof typeof emptyCosts>[]>();
  if (error) throw error;
  if (!options.financial || data.length === 0) return data.map((item) => ({ ...emptyCosts, ...item }));
  const costs = await listCatalogFinancials(client, companyId, data.map(({ id }) => id));
  return data.map((item) => {
    const cost = costs.get(item.id);
    if (!cost) throw new Error('O item mudou durante a consulta. Atualize a lista.');
    return {
      ...item,
      package_price: numberOrNull(cost.package_price),
      unit_cost: numberOrNull(cost.unit_cost),
      rental_cost: numberOrNull(cost.rental_cost),
      markup_percent: numberOrNull(cost.markup_percent),
      material_cost: numberOrNull(cost.material_cost),
    };
  });
}

export type CatalogFinancials = {
  id: string; package_price: string | null; unit_cost: string | null;
  rental_cost: string | null; markup_percent: string | null; material_cost: string | null;
  package_quantity: number | null; quantity: string | null; archived_at: string | null;
};
const emptyCosts = { package_price: null, unit_cost: null, rental_cost: null, markup_percent: null, material_cost: null };
const numberOrNull = (value: string | null) => value === null ? null : Number(value);

export async function listCatalogFinancials(client: SupabaseClient, companyId: string, ids: string[]): Promise<Map<string, CatalogFinancials>> {
  const { data, error } = await client.rpc('catalog_financials', {
    p_company_id: companyId, p_item_ids: ids,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Resposta financeira inválida.');
  return new Map((data as CatalogFinancials[]).map((entry) => [entry.id, entry]));
}

export async function saveItem(client: SupabaseClient, options: {
  companyId: string; kind: Kind; payload: Payload; id: string; previous?: Item; photoUri?: string | null;
}) {
  const { companyId, kind, payload, id, previous, photoUri } = options;
  const images = client.storage.from(bucket);
  let photoPath = photoUri === null ? null : previous?.photo_path ?? null;

  if (photoUri) {
    photoPath = `${companyId}/${id}/${randomUUID()}.jpg`;
    const upload = await images.upload(photoPath, await readPhoto(photoUri), { contentType: 'image/jpeg', upsert: false });
    if (upload.error) throw upload.error;
  }

  const values = { ...payload, photo_path: photoPath };
  let mutation;
  if (previous) {
    const edit = client.from('catalog_items').update(values).eq('company_id', companyId).eq('id', id);
    mutation = previous.photo_path ? edit.eq('photo_path', previous.photo_path) : edit.is('photo_path', null);
  } else {
    mutation = client.from('catalog_items').insert({ ...values, company_id: companyId, kind, id });
  }
  const result = await mutation.select('id').single();

  if (result.error) {
    // A ausência de resposta pode ocorrer depois do commit. A política protege fotos já referenciadas.
    if (photoUri && photoPath) await images.remove([photoPath]).catch(() => undefined);
    throw result.error;
  }
  const oldPath = previous?.photo_path;
  if (oldPath && oldPath !== photoPath) {
    const cleanup = await images.remove([oldPath]).catch(() => ({ error: true }));
    if (cleanup.error) return 'Item salvo. Não foi possível remover a foto anterior do armazenamento.';
  }
  return '';
}

export async function archiveItem(client: SupabaseClient, companyId: string, item: Item) {
  const { error } = await client.from('catalog_items')
    .update({ archived_at: item.archived_at ? null : new Date().toISOString() })
    .eq('company_id', companyId).eq('id', item.id).select('id').single();
  if (error) throw error;
}

export async function getPhotoUrl(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}
