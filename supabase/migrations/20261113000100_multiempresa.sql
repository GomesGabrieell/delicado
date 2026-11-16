begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120)
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner', 'admin', 'member')),
  status text not null check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index company_members_user_idx on public.company_members (user_id, company_id) where status = 'active';

create table private.role_permissions (
  role text not null check (role in ('owner', 'admin', 'member')),
  permission text not null,
  primary key (role, permission)
);
insert into private.role_permissions values
  ('owner', 'company.rename'), ('admin', 'company.rename'),
  ('owner', 'members.list'), ('admin', 'members.list'),
  ('owner', 'members.manage'), ('admin', 'members.manage'),
  ('owner', 'members.manage_privileged');

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table private.role_permissions enable row level security;
revoke all on public.profiles, public.companies, public.company_members from public, anon, authenticated;
revoke all on private.role_permissions from public, anon, authenticated;
grant select on public.profiles, public.companies, public.company_members to authenticated;
grant insert (user_id, display_name), update (display_name) on public.profiles to authenticated;

create function private.is_regular_user() returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null and coalesce(auth.jwt()->>'is_anonymous', 'false') = 'false';
$$;

create function private.has_company_access(p_company_id uuid, p_permission text default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_regular_user() and exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = auth.uid() and m.status = 'active'
      and (p_permission is null or exists (
        select 1 from private.role_permissions p where p.role = m.role and p.permission = p_permission
      ))
  );
$$;

revoke all on function private.is_regular_user(), private.has_company_access(uuid, text) from public, anon, authenticated;
grant execute on function private.is_regular_user(), private.has_company_access(uuid, text) to authenticated;

create policy own_profile_read on public.profiles for select to authenticated
  using (private.is_regular_user() and user_id = (select auth.uid()));
create policy own_profile_insert on public.profiles for insert to authenticated
  with check (private.is_regular_user() and user_id = (select auth.uid()));
create policy own_profile_update on public.profiles for update to authenticated
  using (private.is_regular_user() and user_id = (select auth.uid()))
  with check (private.is_regular_user() and user_id = (select auth.uid()));
create policy company_read on public.companies for select to authenticated
  using (private.has_company_access(id));
create policy members_read on public.company_members for select to authenticated
  using (status = 'active' and private.has_company_access(company_id) and
    (user_id = (select auth.uid()) or private.has_company_access(company_id, 'members.list')));

create function public.create_company(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not private.is_regular_user() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  insert into public.companies (name) values (btrim(p_name)) returning id into new_id;
  insert into public.company_members (company_id, user_id, role, status)
    values (new_id, auth.uid(), 'owner', 'active');
  return new_id;
end;
$$;

create function public.rename_company(p_company_id uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_company_access(p_company_id, 'company.rename') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  perform 1 from public.companies where id = p_company_id for update;
  if not private.has_company_access(p_company_id, 'company.rename') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  update public.companies set name = btrim(p_name) where id = p_company_id;
end;
$$;

create function public.set_company_member(p_company_id uuid, p_user_id uuid, p_role text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare existing public.company_members;
begin
  if not private.has_company_access(p_company_id, 'members.manage') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  perform 1 from public.companies where id = p_company_id for update;
  if not private.has_company_access(p_company_id, 'members.manage') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'member')
    or p_status is null or p_status not in ('active', 'revoked') then
    raise exception 'Papel ou status inválido' using errcode = '23514';
  end if;
  select * into existing from public.company_members where company_id = p_company_id and user_id = p_user_id;
  if (p_role <> 'member' or existing.role <> 'member')
    and not private.has_company_access(p_company_id, 'members.manage_privileged') then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if existing.role = 'owner' and existing.status = 'active'
    and (p_role <> 'owner' or p_status <> 'active')
    and not exists (select 1 from public.company_members
      where company_id = p_company_id and user_id <> p_user_id and role = 'owner' and status = 'active') then
    raise exception 'A empresa precisa de um proprietário ativo' using errcode = '23514';
  end if;
  insert into public.company_members (company_id, user_id, role, status)
    values (p_company_id, p_user_id, p_role, p_status)
    on conflict (company_id, user_id) do update set role = excluded.role, status = excluded.status;
end;
$$;

revoke all on function public.create_company(text), public.rename_company(uuid, text),
  public.set_company_member(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_company(text), public.rename_company(uuid, text),
  public.set_company_member(uuid, uuid, text, text) to authenticated;

commit;
