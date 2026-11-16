begin;

insert into private.role_permissions values ('owner', 'catalog.write'), ('admin', 'catalog.write');

create table public.catalog_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('asset', 'material')),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  unique (company_id, kind, id)
);
create unique index catalog_category_name_idx on public.catalog_categories (company_id, kind, lower(name));

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('balloon', 'asset', 'material')),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 120),
  category_id uuid,
  brand text,
  size text,
  balloon_type text,
  package_quantity integer check (package_quantity between 1 and 1000000),
  package_price numeric(12, 2) check (package_price >= 0 and package_price < 'Infinity'::numeric),
  unit_cost numeric(16, 6) generated always as (round(package_price / nullif(package_quantity, 0), 6)) stored,
  ownership text check (ownership in ('owned', 'rented')),
  rental_cost numeric(12, 2) check (rental_cost >= 0 and rental_cost < 'Infinity'::numeric),
  markup_percent numeric(7, 2) check (markup_percent between 0 and 10000),
  quantity numeric(12, 3) check (quantity > 0 and quantity < 'Infinity'::numeric),
  unit text,
  material_cost numeric(12, 2) check (material_cost >= 0 and material_cost < 'Infinity'::numeric),
  photo_path text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  search_text text generated always as (
    name || ' ' || coalesce(brand, '') || ' ' || coalesce(size, '') || ' ' ||
    coalesce(balloon_type, '') || ' ' || coalesce(unit, '')
  ) stored,
  foreign key (company_id, kind, category_id) references public.catalog_categories(company_id, kind, id),
  check (
    (kind = 'balloon' and category_id is null and
      coalesce(char_length(btrim(brand)), 0) between 1 and 80 and
      coalesce(char_length(btrim(size)), 0) between 1 and 80 and
      coalesce(char_length(btrim(balloon_type)), 0) between 1 and 80 and
      package_quantity is not null and package_price is not null)
    or (kind <> 'balloon' and brand is null and size is null and balloon_type is null and
      package_quantity is null and package_price is null and photo_path is null)
  ),
  check ((kind = 'asset' and category_id is not null and ownership is not null
      and rental_cost is not null and markup_percent is not null)
    or (kind <> 'asset' and ownership is null and rental_cost is null and markup_percent is null)),
  check ((kind = 'material' and category_id is not null and quantity is not null
      and coalesce(char_length(btrim(unit)), 0) between 1 and 40 and material_cost is not null)
    or (kind <> 'material' and quantity is null and unit is null and material_cost is null)),
  check (photo_path is null or photo_path ~ (
    '^' || company_id::text || '/' || id::text || '/[0-9a-f-]{36}[.]jpg$'
  ))
);
create index catalog_list_idx on public.catalog_items (company_id, kind, (archived_at is null), name, id);
create index catalog_item_category_idx on public.catalog_items (company_id, kind, category_id);

alter table public.catalog_categories enable row level security;
alter table public.catalog_items enable row level security;
revoke all on public.catalog_categories, public.catalog_items from public, anon, authenticated;
grant select on public.catalog_categories, public.catalog_items to authenticated;
grant insert (company_id, kind, name) on public.catalog_categories to authenticated;
grant insert (id, company_id, kind, name, category_id, brand, size, balloon_type, package_quantity,
  package_price, ownership, rental_cost, markup_percent, quantity, unit, material_cost, photo_path)
  on public.catalog_items to authenticated;
grant update (name, category_id, brand, size, balloon_type, package_quantity, package_price,
  ownership, rental_cost, markup_percent, quantity, unit, material_cost, photo_path, archived_at)
  on public.catalog_items to authenticated;

create policy catalog_categories_read on public.catalog_categories for select to authenticated
  using (private.has_company_access(company_id));
create policy catalog_categories_create on public.catalog_categories for insert to authenticated
  with check (private.has_company_access(company_id, 'catalog.write'));
create policy catalog_items_read on public.catalog_items for select to authenticated
  using (private.has_company_access(company_id));
create policy catalog_items_create on public.catalog_items for insert to authenticated
  with check (private.has_company_access(company_id, 'catalog.write'));
create policy catalog_items_edit on public.catalog_items for update to authenticated
  using (private.has_company_access(company_id, 'catalog.write'))
  with check (private.has_company_access(company_id, 'catalog.write'));

create function private.seed_catalog_categories(p_company_id uuid) returns void
language sql set search_path = '' as $$
  insert into public.catalog_categories (company_id, kind, name)
  select p_company_id, defaults.kind, defaults.name from (values
    ('asset', 'Painéis e fundos'), ('asset', 'Mesas e cilindros'), ('asset', 'Suportes e estruturas'),
    ('asset', 'Móveis'), ('asset', 'Iluminação'), ('material', 'Fitas'),
    ('material', 'Nylon'), ('material', 'Cola'), ('material', 'Outros materiais')
  ) as defaults(kind, name)
  on conflict do nothing;
$$;
select private.seed_catalog_categories(id) from public.companies;

create function private.seed_company_catalog() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_catalog_categories(new.id);
  return new;
end;
$$;
revoke all on function private.seed_catalog_categories(uuid), private.seed_company_catalog() from public, anon, authenticated;
create trigger company_catalog_categories after insert on public.companies
  for each row execute function private.seed_company_catalog();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-images', 'catalog-images', false, 5242880, array['image/jpeg']);

create function private.catalog_photo_company(p_path text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.]jpg$'
    and split_part(p_path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_path, '/', 1)::uuid end;
$$;
revoke all on function private.catalog_photo_company(text) from public, anon, authenticated;
grant execute on function private.catalog_photo_company(text) to authenticated;

create policy catalog_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'catalog-images' and (
    private.has_company_access(private.catalog_photo_company(name), 'catalog.write') or
    exists (select 1 from public.catalog_items item
      where item.company_id = private.catalog_photo_company(storage.objects.name)
        and item.photo_path = storage.objects.name)
  ));
create policy catalog_photo_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'catalog-images' and
    private.has_company_access(private.catalog_photo_company(name), 'catalog.write'));
create policy catalog_photo_cleanup on storage.objects for delete to authenticated
  using (bucket_id = 'catalog-images' and
    private.has_company_access(private.catalog_photo_company(name), 'catalog.write') and
    not exists (select 1 from public.catalog_items item
      where item.company_id = private.catalog_photo_company(storage.objects.name)
        and item.photo_path = storage.objects.name));

create function private.check_catalog_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.photo_path is not null and not exists (
    select 1 from storage.objects where bucket_id = 'catalog-images' and name = new.photo_path
  ) then
    raise exception 'Foto não encontrada no armazenamento' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.check_catalog_photo() from public, anon, authenticated;
create trigger catalog_check_photo before insert or update of photo_path on public.catalog_items
  for each row execute function private.check_catalog_photo();

commit;
