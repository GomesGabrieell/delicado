begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

insert into auth.users (id, email) values
  ('11000000-0000-0000-0000-000000000001', 'owner-a@example.test'),
  ('11000000-0000-0000-0000-000000000002', 'member-a@example.test'),
  ('11000000-0000-0000-0000-000000000003', 'owner-b@example.test'),
  ('11000000-0000-0000-0000-000000000004', 'admin-a@example.test');

insert into public.companies (id, name) values
  ('22000000-0000-0000-0000-000000000001', 'Empresa A de teste'),
  ('22000000-0000-0000-0000-000000000002', 'Empresa B de teste');

insert into public.company_members (company_id, user_id, role, status) values
  ('22000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('22000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', 'member', 'active'),
  ('22000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000003', 'owner', 'active'),
  ('22000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000004', 'admin', 'active');

set local role anon;
select throws_ok('select id from public.companies', '42501', null, 'Anon não lê empresas');
select throws_ok($$select public.create_company('Empresa anônima')$$,
  '42501', null, 'Anon não cria empresa');

set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000002';

select results_eq('select name from public.companies order by name',
  array['Empresa A de teste'], 'Membro lê apenas sua empresa');
select results_eq('select user_id::text from public.company_members',
  array['11000000-0000-0000-0000-000000000002'], 'Membro lê apenas seu vínculo');
select throws_ok($$update public.company_members set role = 'owner'$$,
  '42501', null, 'Atualização direta de papel é negada');
select throws_ok($$select public.set_company_member(
  '22000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002',
  'owner', 'active')$$, '42501', null, 'Membro não pode se promover pela RPC');
select throws_ok($$select public.rename_company(
  '22000000-0000-0000-0000-000000000002', 'Nome indevido')$$,
  '42501', null, 'Membro não edita empresa de outro tenant');

set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000004';
select throws_ok($$select public.set_company_member(
  '22000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002',
  'admin', 'active')$$, '42501', null, 'Administrador não concede papel de administrador');
select throws_ok($$select public.set_company_member(
  '22000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001',
  'member', 'active')$$, '42501', null, 'Administrador não rebaixa proprietário');
select lives_ok($$select public.rename_company(
  '22000000-0000-0000-0000-000000000001', 'Empresa A revisada')$$,
  'Administrador edita empresa do próprio vínculo');

set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000001';
select throws_ok($$select public.set_company_member(
  '22000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002',
  'member', 'active')$$, '42501', null, 'Proprietário não gerencia vínculos de outra empresa');
select throws_ok($$select public.set_company_member(
  '22000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001',
  'owner', 'revoked')$$, '23514', null, 'Último proprietário ativo é preservado');
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000003';
select lives_ok($$select public.set_company_member(
  '22000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002',
  'member', 'active')$$, 'Proprietário da B ativa vínculo na B');

set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000002';
select results_eq('select name from public.companies order by name',
  array['Empresa A revisada', 'Empresa B de teste'], 'Membro com dois vínculos lê ambas as empresas');

set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000001';
select lives_ok($$select public.set_company_member(
  '22000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002',
  'member', 'revoked')$$, 'Proprietário revoga membro da sua empresa');

set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000002';
select results_eq('select name from public.companies order by name',
  array['Empresa B de teste'], 'Revogação retira acesso à A e preserva B');
select lives_ok($$select public.create_company('Empresa própria de teste')$$,
  'Criação de empresa e vínculo inicial é permitida');
select results_eq($$
  select member.role::text
  from public.company_members as member
  join public.companies as company on company.id = member.company_id
  where company.name = 'Empresa própria de teste'
    and member.user_id = auth.uid() and member.status = 'active'
$$, array['owner'], 'Criação associa o autor como proprietário ativo');

select * from finish();
rollback;
