begin;

create table public.quote_clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  unique (company_id, id)
);
create unique index quote_client_name_idx on public.quote_clients(company_id, lower(btrim(name)));

create table private.quote_counters (
  company_id uuid not null references public.companies on delete cascade,
  year integer not null,
  last_number integer not null check (last_number between 1 and 999999),
  primary key(company_id, year)
);
alter table private.quote_counters enable row level security;
revoke all on private.quote_counters from public, anon, authenticated;

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  client_id uuid,
  code text not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  event_date date,
  location text not null default '' check (char_length(location) <= 240),
  decoration text not null default '' check (char_length(decoration) <= 4000),
  payment_terms text not null default '' check (char_length(payment_terms) <= 2000),
  status text not null default 'draft' check (status in ('draft','ready','archived')),
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, code),
  unique (company_id, id),
  foreign key(company_id, client_id) references public.quote_clients(company_id, id)
);
create index quote_list_idx on public.quotes(company_id, updated_at desc, id);

create table public.quote_financials (
  quote_id uuid primary key,
  company_id uuid not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  captured_at timestamptz not null default clock_timestamp(),
  foreign key(company_id, quote_id) references public.quotes(company_id, id) on delete cascade
);
create table public.quote_history (
  id bigint generated always as identity primary key,
  quote_id uuid not null,
  company_id uuid not null,
  action text not null,
  status text not null,
  happened_at timestamptz not null default clock_timestamp(),
  foreign key(company_id, quote_id) references public.quotes(company_id, id) on delete cascade
);
create index quote_history_lookup on public.quote_history(company_id, quote_id, id desc);

alter table public.quote_clients enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_financials enable row level security;
alter table public.quote_history enable row level security;
revoke all on public.quote_clients, public.quotes, public.quote_financials, public.quote_history from public, anon, authenticated;
grant select on public.quote_clients, public.quotes, public.quote_financials, public.quote_history to authenticated;
grant insert(company_id,name) on public.quote_clients to authenticated;
grant insert(company_id,client_id,title,event_date,location,decoration,payment_terms) on public.quotes to authenticated;
grant update(client_id,title,event_date,location,decoration,payment_terms,status) on public.quotes to authenticated;

create policy quote_clients_read on public.quote_clients for select to authenticated using (private.has_company_access(company_id));
create policy quote_clients_add on public.quote_clients for insert to authenticated with check (private.has_company_access(company_id));
create policy quotes_read on public.quotes for select to authenticated using (private.has_company_access(company_id));
create policy quotes_add on public.quotes for insert to authenticated with check (private.has_company_access(company_id));
create policy quotes_edit on public.quotes for update to authenticated using (private.has_company_access(company_id))
  with check (private.has_company_access(company_id));
create policy quote_cost_read on public.quote_financials for select to authenticated
  using (private.has_company_access(company_id, 'catalog.write'));
create policy quote_history_read on public.quote_history for select to authenticated using (private.has_company_access(company_id));

create function private.prepare_quote() returns trigger language plpgsql security definer set search_path = '' as $$
declare y integer;
declare seq integer;
begin
  if tg_op = 'INSERT' then
    y := extract(year from timezone('America/Sao_Paulo', statement_timestamp()));
    insert into private.quote_counters as c(company_id,year,last_number) values (new.company_id,y,1)
      on conflict(company_id,year) do update set last_number = c.last_number + 1 returning last_number into seq;
    new.code := 'DB-' || y || '-' || lpad(seq::text,6,'0');
  elsif old.status <> new.status then
    if not private.has_company_access(old.company_id,'catalog.write') then
      raise exception 'Acesso negado' using errcode = '42501';
    end if;
    if (old.status = 'archived' and new.status <> 'draft')
      or (new.status = 'ready' and (old.status <> 'draft' or new.client_id is null or new.event_date is null
        or btrim(new.location) = '' or not exists(select 1 from public.quote_financials f where f.quote_id = old.id))) then
      raise exception 'Revise os dados e o cálculo antes de alterar o estado' using errcode = '23514';
    end if;
    if (new.client_id,new.title,new.event_date,new.location,new.decoration,new.payment_terms,new.items)
      is distinct from (old.client_id,old.title,old.event_date,old.location,old.decoration,old.payment_terms,old.items) then
      raise exception 'Salve os dados antes de mudar o estado' using errcode = '23514';
    end if;
  elsif old.status <> 'draft' then
    raise exception 'Reabra o orçamento antes de editar' using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create function private.quote_audit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.quote_history(quote_id,company_id,action,status) values (new.id,new.company_id,
    case when tg_op = 'INSERT' then 'created' when old.status <> new.status then 'status' else 'edited' end,new.status);
  return new;
end;
$$;
revoke all on function private.prepare_quote(), private.quote_audit() from public, anon, authenticated;
create trigger quote_prepare before insert or update on public.quotes for each row execute function private.prepare_quote();
create trigger quote_audit after insert or update of client_id,title,event_date,location,decoration,payment_terms,status
  on public.quotes for each row execute function private.quote_audit();

create function public.save_quote_composition(p_company uuid,p_quote uuid,p_version timestamptz,p_lines jsonb,p_snapshot jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.quotes;
declare line jsonb;
declare item public.catalog_items;
declare result jsonb := '[]';
declare seen uuid[] := '{}';
declare key text;
declare line_input jsonb;
declare qty numeric;
declare expected_cost numeric := 0;
declare expected_markup numeric := 0;
declare base numeric;
declare inputs jsonb := p_snapshot->'inputs';
declare expenses numeric := 0;
declare shipping numeric;
declare gross numeric;
declare discount numeric;
declare entry jsonb;
begin
  if not private.has_company_access(p_company) or
    (p_snapshot is not null and not private.has_company_access(p_company,'catalog.write')) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into q from public.quotes where id = p_quote and company_id = p_company for update;
  if not found or q.status <> 'draft' then
    raise exception 'Orçamento indisponível para edição' using errcode = '42501';
  end if;
  if q.updated_at is distinct from p_version then
    raise exception 'O orçamento mudou desde a abertura' using errcode = '40001';
  end if;
  if p_snapshot is null and exists(select 1 from public.quote_financials where quote_id = q.id) then
    raise exception 'Uma composição com valores registrados exige revisão financeira' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'Composição inválida' using errcode = '23514';
  end if;
  if p_snapshot is not null and (jsonb_typeof(inputs->'lines') is distinct from 'array'
    or jsonb_array_length(inputs->'lines') <> jsonb_array_length(p_lines)) then
    raise exception 'Resumo sem composição válida' using errcode = '23514';
  end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(line) <> 'object' or coalesce(line->>'quantity','') !~ '^[0-9]{1,9}([.][0-9]{1,3})?$'
      or coalesce(line->>'id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
      raise exception 'Composição inválida' using errcode = '23514';
    end if;
    select * into item from public.catalog_items
      where id = (line->>'id')::uuid and company_id = p_company and archived_at is null for share;
    if not found or item.id = any(seen) or (line->>'quantity')::numeric <= 0
      or (item.kind <> 'material' and line->>'quantity' !~ '^[0-9]+$') then
      raise exception 'Item ou quantidade indisponível' using errcode = '23514';
    end if;
    if p_snapshot is not null then
      line_input := (inputs->'lines')->cardinality(seen);
      qty := (line->>'quantity')::numeric;
      if line_input->>'kind' is distinct from item.kind
        or line_input->>'quantity' is distinct from trunc(qty * case when item.kind = 'material' then 1000 else 1 end)::text then
        raise exception 'Composição e cálculo divergentes' using errcode = '23514';
      end if;
      case item.kind
        when 'balloon' then
          if line_input->>'packageSize' is distinct from item.package_quantity::text
            or line_input->>'packagePrice' is distinct from trunc(item.package_price * 100)::text
            or jsonb_typeof(line_input->'whole') is distinct from 'boolean' then
            raise exception 'O catálogo mudou. Reabra a calculadora.' using errcode = '40001';
          end if;
          base := case when (line_input->>'whole')::boolean
            then ceil(qty / item.package_quantity) * item.package_price * 100
            else round(qty * item.package_price * 100 / item.package_quantity) end;
        when 'asset' then
          if line_input->>'rentalCost' is distinct from trunc(item.rental_cost * 100)::text
            or line_input->>'markup' is distinct from trunc(item.markup_percent * 100)::text then
            raise exception 'O catálogo mudou. Reabra a calculadora.' using errcode = '40001';
          end if;
          base := qty * item.rental_cost * 100;
          expected_markup := expected_markup + round(base * item.markup_percent / 100);
        when 'material' then
          if line_input->>'catalogQuantity' is distinct from trunc(item.quantity * 1000)::text
            or line_input->>'catalogCost' is distinct from trunc(item.material_cost * 100)::text then
            raise exception 'O catálogo mudou. Reabra a calculadora.' using errcode = '40001';
          end if;
          base := round(qty * item.material_cost * 100 / item.quantity);
      end case;
      expected_cost := expected_cost + base;
    end if;
    seen := array_append(seen,item.id);
    result := result || jsonb_build_array(jsonb_build_object('id',item.id,'name',item.name,
      'kind',item.kind,'unit',item.unit,'quantity',line->>'quantity'));
  end loop;
  if p_snapshot is not null then
    if jsonb_typeof(p_snapshot) <> 'object' or octet_length(p_snapshot::text) > 200000 then
      raise exception 'Resumo inválido' using errcode = '23514';
    end if;
    foreach key in array array['catalogCost','markup','expenses','transport','labor','totalCost','gross','discount','sale','profit'] loop
      if jsonb_typeof(p_snapshot->key) is distinct from 'string'
        or coalesce(p_snapshot->>key,'') !~ (case when key = 'profit' then '^-?[0-9]{1,30}$' else '^[0-9]{1,30}$' end) then
        raise exception 'Resumo inválido' using errcode = '23514';
      end if;
    end loop;
    if jsonb_typeof(inputs->'expenses') is distinct from 'array'
      or jsonb_typeof(p_snapshot->'expenseNames') is distinct from 'array'
      or coalesce(inputs->>'labor','') !~ '^[0-9]{1,14}$'
      or coalesce(inputs->>'profitPercent','') !~ '^[0-9]{1,7}$'
      or coalesce(inputs#>>'{discount,value}','') !~ '^[0-9]{1,14}$' then
      raise exception 'Parâmetros financeiros inválidos' using errcode = '23514';
    end if;
    if jsonb_array_length(p_snapshot->'expenseNames') <> jsonb_array_length(inputs->'expenses')
      or exists(select 1 from jsonb_array_elements(p_snapshot->'expenseNames') n
        where jsonb_typeof(n) <> 'string' or char_length(btrim(n#>>'{}')) not between 1 and 120) then
      raise exception 'Descrições de despesas inválidas' using errcode = '23514';
    end if;
    for entry in select value from jsonb_array_elements(inputs->'expenses') loop
      if coalesce(entry#>>'{}','') !~ '^[0-9]{1,14}$' then
        raise exception 'Despesa inválida' using errcode = '23514';
      end if;
      expenses := expenses + (entry#>>'{}')::numeric;
    end loop;
    case inputs#>>'{transport,kind}'
      when 'pickup' then shipping := 0;
      when 'fixed' then
        if coalesce(inputs#>>'{transport,cost}','') !~ '^[0-9]{1,14}$' then
          raise exception 'Transporte inválido' using errcode = '23514';
        end if;
        shipping := (inputs#>>'{transport,cost}')::numeric;
      when 'distance' then
        if coalesce(inputs#>>'{transport,km}','') !~ '^[0-9]{1,15}$'
          or coalesce(inputs#>>'{transport,rate}','') !~ '^[0-9]{1,14}$' then
          raise exception 'Transporte inválido' using errcode = '23514';
        end if;
        shipping := round((inputs#>>'{transport,km}')::numeric * (inputs#>>'{transport,rate}')::numeric / 1000);
      else raise exception 'Transporte inválido' using errcode = '23514';
    end case;
    gross := (p_snapshot->>'totalCost')::numeric + expected_markup +
      round((p_snapshot->>'totalCost')::numeric * (inputs->>'profitPercent')::numeric / 10000);
    discount := (inputs#>>'{discount,value}')::numeric;
    case inputs#>>'{discount,kind}'
      when 'fixed' then null;
      when 'percent' then
        if discount > 10000 then raise exception 'Desconto inválido' using errcode = '23514'; end if;
        discount := round(gross * discount / 10000);
      else raise exception 'Desconto inválido' using errcode = '23514';
    end case;
    if (p_snapshot->>'sale')::numeric < 0 or (p_snapshot->>'discount')::numeric < 0
      or (p_snapshot->>'catalogCost')::numeric <> expected_cost or (p_snapshot->>'markup')::numeric <> expected_markup
      or (p_snapshot->>'expenses')::numeric <> expenses or (p_snapshot->>'transport')::numeric <> shipping
      or (p_snapshot->>'labor')::numeric <> (inputs->>'labor')::numeric
      or (inputs->>'profitPercent')::numeric > 1000000
      or (p_snapshot->>'gross')::numeric <> gross or (p_snapshot->>'discount')::numeric <> discount
      or (p_snapshot->>'sale')::numeric <> (p_snapshot->>'gross')::numeric - (p_snapshot->>'discount')::numeric
      or (p_snapshot->>'profit')::numeric <> (p_snapshot->>'sale')::numeric - (p_snapshot->>'totalCost')::numeric
      or (p_snapshot->>'totalCost')::numeric <> (p_snapshot->>'catalogCost')::numeric + (p_snapshot->>'expenses')::numeric
         + (p_snapshot->>'transport')::numeric + (p_snapshot->>'labor')::numeric
      or (case when (p_snapshot->>'sale')::numeric = 0 then p_snapshot->>'margin' is not null
        when jsonb_typeof(p_snapshot->'margin') is distinct from 'string'
          or coalesce(p_snapshot->>'margin','') !~ '^-?[0-9]{1,34}$' then true
        else (p_snapshot->>'margin')::numeric <> round((p_snapshot->>'profit')::numeric * 10000 / (p_snapshot->>'sale')::numeric) end) then
      raise exception 'Totais inconsistentes' using errcode = '23514';
    end if;
    insert into public.quote_financials(quote_id,company_id,snapshot) values (q.id,p_company,p_snapshot)
      on conflict(quote_id) do update set snapshot = excluded.snapshot,captured_at = clock_timestamp();
  end if;
  update public.quotes set items = result where id = q.id;
  insert into public.quote_history(quote_id,company_id,action,status)
    values(q.id,p_company,case when p_snapshot is null then 'composition' else 'calculated' end,q.status);
end;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('quote-inspiration','quote-inspiration',false,5242880,array['image/jpeg']);
create table public.quote_images (
  quote_id uuid not null,
  company_id uuid not null,
  path text not null check (private.catalog_photo_company(path) is not null and private.catalog_photo_company(path) = company_id),
  primary key(quote_id,path),
  foreign key(company_id,quote_id) references public.quotes(company_id,id) on delete cascade
);
alter table public.quote_images enable row level security;
revoke all on public.quote_images from public, anon, authenticated;
grant select on public.quote_images to authenticated;
create policy quote_images_read on public.quote_images for select to authenticated using(private.has_company_access(company_id));
create policy quote_objects_read on storage.objects for select to authenticated using(bucket_id = 'quote-inspiration'
  and private.has_company_access(private.catalog_photo_company(name)));
create policy quote_objects_add on storage.objects for insert to authenticated with check(bucket_id = 'quote-inspiration'
  and private.has_company_access(private.catalog_photo_company(name))
  and exists(select 1 from public.quotes q where q.company_id = private.catalog_photo_company(storage.objects.name)
    and q.id::text = split_part(storage.objects.name,'/',2) and q.status = 'draft'));
create policy quote_objects_cleanup on storage.objects for delete to authenticated using(bucket_id = 'quote-inspiration'
  and private.has_company_access(private.catalog_photo_company(name))
  and not exists(select 1 from public.quote_images qi where qi.path = storage.objects.name));

create function public.attach_quote_image(p_company uuid,p_quote uuid,p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.quotes;
begin
  if not private.has_company_access(p_company) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select * into q from public.quotes where id = p_quote and company_id = p_company for update;
  if not found or q.status <> 'draft' or private.catalog_photo_company(p_path) is distinct from p_company
    or split_part(p_path,'/',2) <> p_quote::text then
    raise exception 'Imagem indisponível' using errcode = '42501';
  end if;
  if exists(select 1 from public.quote_images where quote_id = p_quote and path = p_path) then
    return;
  end if;
  if (select count(*) from public.quote_images where quote_id = p_quote) >= 20 or
    not exists(select 1 from storage.objects where bucket_id = 'quote-inspiration' and name = p_path) then
    raise exception 'Imagem indisponível ou limite de anexos atingido' using errcode = '23514';
  end if;
  insert into public.quote_images values(p_quote,p_company,p_path);
  insert into public.quote_history(quote_id,company_id,action,status) values(p_quote,p_company,'image',q.status);
end;
$$;

create function public.duplicate_quote(p_company uuid,p_quote uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare q public.quotes;
declare new_id uuid;
begin
  if not private.has_company_access(p_company) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select * into q from public.quotes where id = p_quote and company_id = p_company for share;
  if not found then raise exception 'Orçamento indisponível' using errcode = '42501'; end if;
  insert into public.quotes(company_id,client_id,title,event_date,location,decoration,payment_terms,items)
    values(q.company_id,q.client_id,left(q.title,111)||' (cópia)',q.event_date,q.location,q.decoration,q.payment_terms,q.items)
    returning id into new_id;
  if private.has_company_access(p_company,'catalog.write') then
    insert into public.quote_financials select new_id,company_id,snapshot,captured_at
      from public.quote_financials where quote_id = p_quote;
  end if;
  insert into public.quote_images select new_id,company_id,path from public.quote_images where quote_id = p_quote;
  insert into public.quote_history(quote_id,company_id,action,status) values(new_id,p_company,'duplicated','draft');
  return new_id;
end;
$$;

revoke all on function public.save_quote_composition(uuid,uuid,timestamptz,jsonb,jsonb),public.duplicate_quote(uuid,uuid),
  public.attach_quote_image(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_quote_composition(uuid,uuid,timestamptz,jsonb,jsonb),public.duplicate_quote(uuid,uuid),
  public.attach_quote_image(uuid,uuid,text) to authenticated;
commit;
