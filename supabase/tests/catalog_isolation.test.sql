begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(28);

insert into auth.users (id, email) values
  ('11000000-0000-0000-0000-000000000011', 'admin-catalog@example.test'),
  ('11000000-0000-0000-0000-000000000012', 'member-catalog@example.test'),
  ('11000000-0000-0000-0000-000000000013', 'owner-catalog@example.test');
insert into public.companies (id, name) values
  ('22000000-0000-0000-0000-000000000011', 'Empresa A de teste'),
  ('22000000-0000-0000-0000-000000000012', 'Empresa B de teste');
insert into public.company_members (company_id, user_id, role, status) values
  ('22000000-0000-0000-0000-000000000011', '11000000-0000-0000-0000-000000000011', 'admin', 'active'),
  ('22000000-0000-0000-0000-000000000011', '11000000-0000-0000-0000-000000000012', 'member', 'active'),
  ('22000000-0000-0000-0000-000000000012', '11000000-0000-0000-0000-000000000013', 'owner', 'active');

set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000011';
select is((select count(*) from public.catalog_categories), 9::bigint, 'Categorias iniciais apenas da empresa A');
select lives_ok($$insert into public.catalog_categories (company_id, kind, name)
  values ('22000000-0000-0000-0000-000000000011', 'material', 'Categoria própria')$$,
  'Administrador cria categoria própria');
select throws_ok($$insert into public.catalog_categories (company_id, kind, name)
  values ('22000000-0000-0000-0000-000000000012', 'material', 'Categoria cruzada')$$,
  '42501', null, 'Administrador não cria categoria em outra empresa');
select lives_ok($$insert into public.catalog_items
  (id, company_id, kind, name, brand, size, balloon_type, package_quantity, package_price)
  values ('33000000-0000-0000-0000-000000000011', '22000000-0000-0000-0000-000000000011',
  'balloon', 'Balão A', 'Marca', '10', 'Látex', 30, 10)$$, 'Administrador cria balão');
select is((select unit_cost::numeric from public.catalog_financials(
  '22000000-0000-0000-0000-000000000011', array['33000000-0000-0000-0000-000000000011'::uuid])),
  0.333333::numeric, 'Custo unitário calculado pelo banco');
select throws_ok($$update public.catalog_items set package_quantity = 0$$,
  '23514', null, 'Quantidade zero rejeitada');
select throws_ok($$update public.catalog_items set company_id = '22000000-0000-0000-0000-000000000012'$$,
  '42501', null, 'Empresa do item é imutável');
select lives_ok($$update public.catalog_items set archived_at = now()$$, 'Administrador arquiva item');
select is((select count(*) from public.catalog_items where archived_at is not null), 1::bigint, 'Arquivamento persistido');
select throws_ok($$insert into storage.objects (bucket_id, name) values
  ('catalog-images', '22000000-0000-0000-0000-000000000012/33000000-0000-0000-0000-000000000011/44000000-0000-0000-0000-000000000011.jpg')$$,
  '42501', null, 'Administrador não envia foto para outra empresa');
select lives_ok($$insert into storage.objects (bucket_id, name) values
  ('catalog-images', '22000000-0000-0000-0000-000000000011/33000000-0000-0000-0000-000000000011/44000000-0000-0000-0000-000000000011.jpg')$$,
  'Política autoriza upload na própria empresa');
select lives_ok($$update public.catalog_items set photo_path =
  '22000000-0000-0000-0000-000000000011/33000000-0000-0000-0000-000000000011/44000000-0000-0000-0000-000000000011.jpg'$$,
  'Administrador vincula foto ao item');
select throws_ok($$update public.catalog_items set photo_path =
  '22000000-0000-0000-0000-000000000011/33000000-0000-0000-0000-000000000011/44000000-0000-0000-0000-000000000012.jpg'$$,
  '23514', null, 'Foto inexistente não pode ser vinculada');
select results_eq($$with deleted as (delete from storage.objects where bucket_id = 'catalog-images' returning 1)
  select count(*) from deleted$$, array[0::bigint], 'Política protege foto referenciada de remoção');

set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000012';
select is((select count(*) from public.catalog_items), 1::bigint, 'Funcionário consulta item da empresa');
select is((select count(*) from storage.objects where bucket_id = 'catalog-images'), 1::bigint, 'Funcionário consulta foto vinculada');
select results_eq($$with changed as (update public.catalog_items set name = 'Alteração' returning 1)
  select count(*) from changed$$, array[0::bigint], 'Funcionário não altera item');
select throws_ok($$insert into storage.objects (bucket_id, name) values
  ('catalog-images', '22000000-0000-0000-0000-000000000011/33000000-0000-0000-0000-000000000011/44000000-0000-0000-0000-000000000012.jpg')$$,
  '42501', null, 'Funcionário não envia foto');

set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000013';
select is((select count(*) from public.catalog_items), 0::bigint, 'Outra empresa não lê itens');
select is((select count(*) from storage.objects where bucket_id = 'catalog-images'), 0::bigint, 'Outra empresa não lê fotos');

reset role;
insert into public.catalog_categories (id, company_id, kind, name) values
  ('55000000-0000-0000-0000-000000000012', '22000000-0000-0000-0000-000000000012', 'material', 'Outra categoria');
set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000011';
select throws_ok($$insert into public.catalog_items (company_id, kind, name, category_id, quantity, unit, material_cost)
  values ('22000000-0000-0000-0000-000000000011', 'material', 'Material',
  '55000000-0000-0000-0000-000000000012', 1, 'm', 1)$$,
  '23503', null, 'Categoria de outra empresa não pode ser associada');
select public.set_company_member('22000000-0000-0000-0000-000000000011',
  '11000000-0000-0000-0000-000000000012', 'member', 'revoked');
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000012';
select is((select count(*) from public.catalog_items), 0::bigint, 'Revogação bloqueia o catálogo na sessão atual');

set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000011';
select lives_ok($$insert into public.catalog_items (company_id, kind, name, category_id, ownership, rental_cost, markup_percent)
  select company_id, 'asset', 'Painel', id, 'owned', 25, 10
  from public.catalog_categories where kind = 'asset' and name = 'Painéis e fundos'$$,
  'Acervo aceita categoria própria e valores de locação');
select lives_ok($$insert into public.catalog_items (company_id, kind, name, category_id, quantity, unit, material_cost)
  select company_id, 'material', 'Fita', id, 0.125, 'm', 5
  from public.catalog_categories where kind = 'material' and name = 'Fitas'$$,
  'Material aceita quantidade fracionária');
select results_eq($$select kind from public.catalog_items where kind <> 'balloon' order by kind$$,
  array['asset', 'material'], 'Acervo e material persistem em seus grupos');
select throws_ok($$insert into public.catalog_items (company_id, kind, name, category_id, quantity, unit, material_cost)
  select company_id, 'material', 'Material inválido', id, 1, 'm', 5
  from public.catalog_categories where kind = 'asset' and name = 'Painéis e fundos'$$,
  '23503', null, 'Categoria de outro grupo é rejeitada');
set local request.jwt.claims = '{"is_anonymous": true}';
select is((select count(*) from public.catalog_items), 0::bigint, 'Sessão anônima autenticada não lê itens');
set local role anon;
select throws_ok('select id from public.catalog_items', '42501', null, 'Papel anon não acessa o catálogo');

select * from finish();
rollback;
