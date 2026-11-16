begin;

alter table public.quote_clients
  add column document text,
  add column whatsapp text check (whatsapp ~ '^[+]?[0-9]{10,15}$'),
  add column email text check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  add column address text check (char_length(address) <= 500),
  add column notes text check (char_length(notes) <= 2000),
  add column archived_at timestamptz,
  add column updated_at timestamptz not null default clock_timestamp();

create function private.valid_client_document(value text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare cpf boolean := length(value) = 11;
declare prefix text;
declare weights int[];
declare total int;
declare digit int;
begin
  if value is null then return true; end if;
  if (value !~ '^[0-9]{11}$' and value !~ '^[A-Z0-9]{12}[0-9]{2}$')
    or value = repeat(left(value, 1), length(value)) then return false; end if;
  prefix := left(value, length(value) - 2);
  for step in 1..2 loop
    weights := case when cpf and step = 1 then array[10,9,8,7,6,5,4,3,2]
      when cpf then array[11,10,9,8,7,6,5,4,3,2]
      when step = 1 then array[5,4,3,2,9,8,7,6,5,4,3,2]
      else array[6,5,4,3,2,9,8,7,6,5,4,3,2] end;
    total := 0;
    for pos in 1..length(prefix) loop
      total := total + (ascii(substr(prefix,pos,1)) - 48) * weights[pos];
    end loop;
    digit := case when total % 11 < 2 then 0 else 11 - total % 11 end;
    prefix := prefix || digit;
  end loop;
  return prefix = value;
end;
$$;
revoke all on function private.valid_client_document(text) from public, anon, authenticated;
grant execute on function private.valid_client_document(text) to authenticated;
alter table public.quote_clients add constraint client_document_valid check (private.valid_client_document(document));
create unique index client_document_unique on public.quote_clients(company_id,document) where document is not null;
create index clients_status_name on public.quote_clients(company_id,(archived_at is null),name,id);
create index quotes_by_client on public.quotes(company_id,client_id,created_at desc,id);

revoke select on public.quote_clients from public, anon, authenticated;
grant select(id,company_id,name,archived_at,updated_at) on public.quote_clients to authenticated;
insert into private.role_permissions values ('owner','clients.manage'),('admin','clients.manage');

create table public.client_audit (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  client_id uuid not null,
  actor_id uuid references auth.users on delete set null,
  action text not null check(action in ('created','edited','archived','restored')),
  changed_fields text[] not null default '{}',
  happened_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,client_id) references public.quote_clients(company_id,id) on delete cascade
);
create index client_audit_lookup on public.client_audit(company_id,client_id,id desc);
alter table public.client_audit enable row level security;
revoke all on public.client_audit from public,anon,authenticated;
grant select on public.client_audit to authenticated;
create policy client_audit_read on public.client_audit for select to authenticated
  using(private.has_company_access(company_id,'clients.manage'));

create function private.record_client_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare changed text[];
begin
  if tg_op = 'INSERT' then
    insert into public.client_audit(company_id,client_id,actor_id,action)
      values(new.company_id,new.id,auth.uid(),'created');
  else
    select coalesce(array_agg(field order by field),'{}') into changed
    from jsonb_each(to_jsonb(new) - 'updated_at') as entry(field,value)
    where value is distinct from to_jsonb(old)->field;
    if cardinality(changed) > 0 then
      insert into public.client_audit(company_id,client_id,actor_id,action,changed_fields)
        values(new.company_id,new.id,auth.uid(),case when old.archived_at is null and new.archived_at is not null then 'archived'
          when old.archived_at is not null and new.archived_at is null then 'restored' else 'edited' end,changed);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.record_client_change() from public,anon,authenticated;
create trigger client_audit after insert or update on public.quote_clients
  for each row execute function private.record_client_change();

create function public.client_details(p_company uuid,p_client uuid)
returns table(document text,whatsapp text,email text,address text,notes text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_company_access(p_company,'clients.manage') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return query select c.document,c.whatsapp,c.email,c.address,c.notes from public.quote_clients c
    where c.company_id = p_company and c.id = p_client;
end;
$$;

create function public.search_clients_by_document(p_company uuid,p_search text,p_archived boolean,p_offset integer)
returns table(id uuid,name text,archived_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_company_access(p_company,'clients.manage') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if coalesce(p_search,'') !~ '^[0-9A-Z]{1,14}$' then return; end if;
  return query select c.id,c.name,c.archived_at,c.updated_at from public.quote_clients c
    where c.company_id = p_company and (c.archived_at is not null) = p_archived
      and c.document like p_search || '%'
    order by c.name,c.id limit 21 offset greatest(0,p_offset);
end;
$$;

create function public.save_client(p_company uuid,p_client uuid,p_version timestamptz,
  p_name text,p_document text,p_whatsapp text,p_email text,p_address text,p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare saved uuid;
begin
  if not private.has_company_access(p_company,'clients.manage') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_client is null then
    insert into public.quote_clients(company_id,name,document,whatsapp,email,address,notes)
      values(p_company,btrim(p_name),p_document,p_whatsapp,p_email,p_address,p_notes) returning id into saved;
  else
    update public.quote_clients set name = btrim(p_name),document = p_document,whatsapp = p_whatsapp,
      email = p_email,address = p_address,notes = p_notes,updated_at = clock_timestamp()
      where company_id = p_company and id = p_client and updated_at = p_version and archived_at is null returning id into saved;
    if not found then raise exception 'Cadastro alterado ou indisponível' using errcode = '40001'; end if;
  end if;
  return saved;
end;
$$;

create function public.set_client_archived(p_company uuid,p_client uuid,p_version timestamptz,p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_company_access(p_company,'clients.manage') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  update public.quote_clients set archived_at = case when p_archived then clock_timestamp() end,updated_at = clock_timestamp()
    where company_id = p_company and id = p_client and updated_at = p_version and (archived_at is null) = p_archived;
  if not found then raise exception 'Cadastro alterado ou indisponível' using errcode = '40001'; end if;
end;
$$;

create function private.validate_quote_client() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id then return new; end if;
  if exists(select 1 from public.quote_clients c where c.company_id = new.company_id and c.id = new.client_id
    and c.archived_at is not null) then
    raise exception 'Cliente arquivado' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_quote_client() from public,anon,authenticated;
create trigger quote_validate_client before insert or update of client_id on public.quotes
  for each row execute function private.validate_quote_client();

revoke all on function public.client_details(uuid,uuid),public.search_clients_by_document(uuid,text,boolean,integer),
  public.save_client(uuid,uuid,timestamptz,text,text,text,text,text,text),
  public.set_client_archived(uuid,uuid,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.client_details(uuid,uuid),public.search_clients_by_document(uuid,text,boolean,integer),
  public.save_client(uuid,uuid,timestamptz,text,text,text,text,text,text),
  public.set_client_archived(uuid,uuid,timestamptz,boolean) to authenticated;
commit;
