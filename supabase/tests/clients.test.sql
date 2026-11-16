begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(23);

insert into auth.users(id,email) values
 ('11000000-0000-0000-0000-000000000051','admin-clients@example.test'),
 ('11000000-0000-0000-0000-000000000052','member-clients@example.test'),
 ('11000000-0000-0000-0000-000000000053','other-clients@example.test');
insert into public.companies(id,name) values
 ('22000000-0000-0000-0000-000000000051','A'),('22000000-0000-0000-0000-000000000052','B');
insert into public.company_members(company_id,user_id,role,status) values
 ('22000000-0000-0000-0000-000000000051','11000000-0000-0000-0000-000000000051','admin','active'),
 ('22000000-0000-0000-0000-000000000051','11000000-0000-0000-0000-000000000052','member','active'),
 ('22000000-0000-0000-0000-000000000052','11000000-0000-0000-0000-000000000053','owner','active');
insert into public.quote_clients(id,company_id,name)
 values('33000000-0000-0000-0000-000000000051','22000000-0000-0000-0000-000000000051','Cadastro legado');
insert into public.quotes(company_id,client_id,title)
 values('22000000-0000-0000-0000-000000000051','33000000-0000-0000-0000-000000000051','Orçamento existente');

set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000051';
select ok(private.valid_client_document('52998224725') and private.valid_client_document('11222333000181')
  and private.valid_client_document('12ABC34501DE35') and not private.valid_client_document('12ABC34501DE36'),
  'Valida CPF e CNPJ numérico e alfanumérico');
select lives_ok($$select public.save_client(company_id,id,updated_at,'Cliente editado','52998224725',
  '+5511999999999','cliente@example.test','Endereço','Observação') from public.quote_clients$$,'Admin edita cliente legado');
select results_eq($$select d.document,d.email from public.quote_clients c cross join lateral public.client_details(c.company_id,c.id) d$$,
  $$values ('52998224725'::text,'cliente@example.test'::text)$$,'Alteração persiste e é consultável');
select is((select title from public.quotes where client_id = '33000000-0000-0000-0000-000000000051'),
  'Orçamento existente','Vínculo permanece após edição');
select lives_ok($$select public.save_client('22000000-0000-0000-0000-000000000051',null,null,'Nova empresa',
  '12ABC34501DE35',null,null,null,null)$$,'Admin cadastra CNPJ alfanumérico');
select throws_ok($$select public.save_client('22000000-0000-0000-0000-000000000051',null,null,'Duplicado',
  '52998224725',null,null,null,null)$$,'23505',null,'Documento duplicado na mesma empresa é rejeitado');
select throws_ok($$select public.save_client('22000000-0000-0000-0000-000000000051',null,null,'Inválido',
  '52998224726',null,null,null,null)$$,'23514',null,'Banco rejeita documento inválido');
select is((select name from public.search_clients_by_document('22000000-0000-0000-0000-000000000051','529',false,0)),
  'Cliente editado','Busca por documento retorna cliente da empresa');
select throws_ok($$select public.save_client(company_id,id,'2000-01-01','Conflito',null,null,null,null,null)
  from public.quote_clients where name = 'Cliente editado'$$,'40001',null,'Edição concorrente é rejeitada');
select lives_ok($$select public.set_client_archived(company_id,id,updated_at,true)
  from public.quote_clients where name = 'Cliente editado'$$,'Admin arquiva');
select throws_ok($$insert into public.quotes(company_id,client_id,title)
  values('22000000-0000-0000-0000-000000000051','33000000-0000-0000-0000-000000000051','Novo orçamento')$$,
  '23514',null,'Cliente arquivado não recebe novo vínculo');
select lives_ok($$update public.quotes set title = 'Orçamento editado'$$,'Histórico existente continua editável');
select lives_ok($$select public.set_client_archived(company_id,id,updated_at,false)
  from public.quote_clients where name = 'Cliente editado'$$,'Admin reativa');
select is((select count(*) from public.client_audit where actor_id = '11000000-0000-0000-0000-000000000051'
  and action in ('edited','archived','restored')),3::bigint,'Auditoria registra autor e mudanças');

set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000052';
select is((select count(id) from public.quote_clients),2::bigint,'Funcionário consulta cadastro básico');
select throws_ok('select document from public.quote_clients','42501',null,'Funcionário não lê documento direto');
select throws_ok($$select public.client_details(company_id,id) from public.quote_clients$$,'42501',null,'RPC não expõe dados privados ao funcionário');
select throws_ok($$select public.save_client(company_id,id,updated_at,'Sem acesso',null,null,null,null,null)
  from public.quote_clients$$,'42501',null,'Funcionário não edita cadastro');
select throws_ok($$select * from public.search_clients_by_document('22000000-0000-0000-0000-000000000051','529',false,0)$$,
  '42501',null,'Funcionário não pode inferir documentos pela busca');
select lives_ok($$insert into public.quote_clients(company_id,name)
  values('22000000-0000-0000-0000-000000000051','Cadastro básico') returning id,name$$,
  'Fluxo existente de orçamento ainda cria cliente básico');
select throws_ok($$insert into public.quote_clients(company_id,name,document)
  values('22000000-0000-0000-0000-000000000051','Dados restritos','52998224725')$$,
  '42501',null,'Funcionário não escreve dados privados por acesso direto');
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000053';
select is((select count(id) from public.quote_clients),0::bigint,'Outra empresa não vê clientes');
select lives_ok($$select public.save_client('22000000-0000-0000-0000-000000000052',null,null,'Cliente B',
  '52998224725',null,null,null,null)$$,'Mesmo documento é permitido em outra empresa');

select * from finish();
rollback;
