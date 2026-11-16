begin;

-- Os dados operacionais continuam sujeitos à RLS do catálogo. Custos exigem a RPC abaixo.
revoke select on public.catalog_items from public, anon, authenticated;
grant select (id, company_id, kind, name, category_id, brand, size, balloon_type, package_quantity,
  ownership, quantity, unit, photo_path, archived_at, created_at, search_text)
  on public.catalog_items to authenticated;

create function public.catalog_financials(p_company_id uuid, p_item_ids uuid[])
returns table (id uuid, package_price text, unit_cost text, rental_cost text, markup_percent text, material_cost text,
  package_quantity integer, quantity text, archived_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_company_access(p_company_id, 'catalog.write') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_item_ids), 0) > 200 then
    raise exception 'Limite de itens excedido' using errcode = '22023';
  end if;
  return query select i.id, i.package_price::text, i.unit_cost::text, i.rental_cost::text,
    i.markup_percent::text, i.material_cost::text, i.package_quantity, i.quantity::text, i.archived_at
  from public.catalog_items i where i.company_id = p_company_id and i.id = any(p_item_ids);
end;
$$;
revoke all on function public.catalog_financials(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.catalog_financials(uuid, uuid[]) to authenticated;

create table public.calculator_defaults (
  company_id uuid primary key references public.companies(id) on delete cascade,
  profit_percent numeric(7, 2) not null check (profit_percent between 0 and 10000)
);
alter table public.calculator_defaults enable row level security;
revoke all on public.calculator_defaults from public, anon, authenticated;
grant select, insert on public.calculator_defaults to authenticated;
grant update (profit_percent) on public.calculator_defaults to authenticated;
create policy calculator_defaults_read on public.calculator_defaults for select to authenticated
  using (private.has_company_access(company_id, 'catalog.write'));
create policy calculator_defaults_create on public.calculator_defaults for insert to authenticated
  with check (private.has_company_access(company_id, 'catalog.write'));
create policy calculator_defaults_edit on public.calculator_defaults for update to authenticated
  using (private.has_company_access(company_id, 'catalog.write'))
  with check (private.has_company_access(company_id, 'catalog.write'));

create function public.set_calculator_default(p_company_id uuid, p_profit_percent numeric)
returns void language sql set search_path = '' as $$
  insert into public.calculator_defaults (company_id, profit_percent)
  values (p_company_id, p_profit_percent)
  on conflict (company_id) do update set profit_percent = excluded.profit_percent;
$$;
revoke all on function public.set_calculator_default(uuid, numeric) from public, anon, authenticated;
grant execute on function public.set_calculator_default(uuid, numeric) to authenticated;

create table public.calculator_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  lines jsonb not null,
  updated_at timestamptz not null default now()
);
create index calculator_drafts_company_idx on public.calculator_drafts (company_id, updated_at desc);
alter table public.calculator_drafts enable row level security;
revoke all on public.calculator_drafts from public, anon, authenticated;
grant select on public.calculator_drafts to authenticated;
grant insert (company_id, name, lines) on public.calculator_drafts to authenticated;
grant update (name, lines) on public.calculator_drafts to authenticated;
create policy calculator_drafts_read on public.calculator_drafts for select to authenticated using (
  private.has_company_access(company_id) and
  (created_by = (select auth.uid()) or private.has_company_access(company_id, 'catalog.write'))
);
create policy calculator_drafts_create on public.calculator_drafts for insert to authenticated
  with check (private.has_company_access(company_id) and created_by = (select auth.uid()));
create policy calculator_drafts_edit on public.calculator_drafts for update to authenticated using (
  private.has_company_access(company_id) and
  (created_by = (select auth.uid()) or private.has_company_access(company_id, 'catalog.write'))
) with check (
  private.has_company_access(company_id) and
  (created_by = (select auth.uid()) or private.has_company_access(company_id, 'catalog.write'))
);

create function private.validate_calculator_draft() returns trigger
language plpgsql set search_path = '' as $$
declare line jsonb;
declare item_id uuid;
declare item_kind text;
declare seen uuid[] := '{}';
begin
  if jsonb_typeof(new.lines) <> 'array' then
    raise exception 'Composição inválida' using errcode = '23514';
  end if;
  if jsonb_array_length(new.lines) > 200 then
    raise exception 'Limite de itens excedido' using errcode = '23514';
  end if;
  for line in select value from jsonb_array_elements(new.lines) loop
    if jsonb_typeof(line) <> 'object' or not (line ?& array['id', 'quantity']) then
      raise exception 'Item inválido' using errcode = '23514';
    end if;
    if line - 'id' - 'quantity' <> '{}'::jsonb
      or jsonb_typeof(line->'quantity') <> 'string'
      or (line->>'quantity') !~ '^[0-9]{1,9}([.][0-9]{1,3})?$'
      or coalesce(line->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Dados do item inválidos' using errcode = '23514';
    end if;
    item_id := (line->>'id')::uuid;
    select i.kind into item_kind from public.catalog_items i
      where i.company_id = new.company_id and i.id = item_id and i.archived_at is null;
    if not found or item_id = any(seen) or (line->>'quantity')::numeric <= 0
      or (item_kind <> 'material' and (line->>'quantity') !~ '^[0-9]+$') then
      raise exception 'Item ou quantidade indisponível' using errcode = '23514';
    end if;
    seen := array_append(seen, item_id);
  end loop;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.validate_calculator_draft() from public, anon, authenticated;
create trigger calculator_draft_validate before insert or update on public.calculator_drafts
  for each row execute function private.validate_calculator_draft();

commit;
