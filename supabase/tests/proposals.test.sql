begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

insert into auth.users(id,email) values
 ('11000000-0000-0000-0000-000000000061','owner-proposal@example.test'),
 ('11000000-0000-0000-0000-000000000062','member-proposal@example.test'),
 ('11000000-0000-0000-0000-000000000063','other-proposal@example.test');
insert into public.companies(id,name) values
 ('22000000-0000-0000-0000-000000000061','A'),('22000000-0000-0000-0000-000000000062','B');
insert into public.company_members(company_id,user_id,role,status) values
 ('22000000-0000-0000-0000-000000000061','11000000-0000-0000-0000-000000000061','owner','active'),
 ('22000000-0000-0000-0000-000000000061','11000000-0000-0000-0000-000000000062','member','active'),
 ('22000000-0000-0000-0000-000000000062','11000000-0000-0000-0000-000000000063','owner','active');
insert into public.quote_clients(id,company_id,name,notes) values
 ('33000000-0000-0000-0000-000000000061','22000000-0000-0000-0000-000000000061','Cliente','Privado');
insert into public.quotes(id,company_id,client_id,title,event_date,location,decoration,payment_terms,status) values
 ('44000000-0000-0000-0000-000000000061','22000000-0000-0000-0000-000000000061','33000000-0000-0000-0000-000000000061',
  'Evento','2027-01-01','Salão','Decoração','Entrada e saldo','ready');
insert into public.quote_financials values
 ('44000000-0000-0000-0000-000000000061','22000000-0000-0000-0000-000000000061',
  '{"sale":"12500","totalCost":"9000","profit":"3500","margin":"2800"}',now());

set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000061';
select lives_ok($$select public.save_proposal_brand('22000000-0000-0000-0000-000000000061','Estúdio','#475E71','5511999999999')$$,
  'Administrador salva identidade');
select set_config('test.proposal_token', public.issue_proposal(
  '22000000-0000-0000-0000-000000000061','44000000-0000-0000-0000-000000000061')->>'token',true) is not null;
select matches(current_setting('test.proposal_token'),'^[a-f0-9]{64}$','Emissão gera token');
select is((select expires_at - sent_at from public.commercial_proposals), interval '48 hours','Validade de dois dias corridos');
select is((select content->>'total' from public.commercial_proposals),'12500','Proposta usa preço registrado no orçamento');
select ok((select not (content ?| array['totalCost','profit','margin','notes']) from public.commercial_proposals),'Snapshot exclui dados privados');
select throws_ok('select token_hash from public.commercial_proposals','42501',null,'Administrador não lê hashes');
select throws_ok($$select public.read_public_proposal(current_setting('test.proposal_token'))$$,'42501',null,'RPC pública só pode ser chamada pelo backend');

reset role;
select is(public.read_public_proposal(repeat('0',64)),null::jsonb,'Token inválido não retorna dados');
select is(public.read_public_proposal(current_setting('test.proposal_token'))#>>'{content,customer}','Cliente','Token só retorna a proposta');
select throws_ok($$select public.respond_public_proposal(current_setting('test.proposal_token'),'declined',null)$$,
  '22023',null,'Recusa exige resposta sobre nova proposta');
select is(public.respond_public_proposal(current_setting('test.proposal_token'),'approved',null)->>'decision','approved',
  'Aprovação registrada');
select ok(public.respond_public_proposal(current_setting('test.proposal_token'),'approved',null)->>'respondedAt' is not null,
  'Repetição da mesma resposta preserva registro');
select throws_ok($$select public.respond_public_proposal(current_setting('test.proposal_token'),'negotiate',null)$$,
  '23505',null,'Resposta diferente não sobrescreve a aprovação');
select is((select status from public.quotes),'ready','Resposta não altera o orçamento');
update public.commercial_proposals set sent_at = now() - interval '3 days', expires_at = now() - interval '1 day';
select is(public.read_public_proposal(current_setting('test.proposal_token')),null::jsonb,'Link expirado não retorna dados');

set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000061';
select is((select count(id) from public.commercial_proposals where responded_at is not null and notification_read_at is null),
  1::bigint,'Aprovação aparece como nova notificação');
select lives_ok($$select public.manage_proposal(company_id,id,'read') from public.commercial_proposals$$,'Administrador marca resposta como lida');
select set_config('test.old_token',public.issue_proposal(
  '22000000-0000-0000-0000-000000000061','44000000-0000-0000-0000-000000000061')->>'token',true) is not null;
select set_config('test.negotiate_token',public.issue_proposal(
  '22000000-0000-0000-0000-000000000061','44000000-0000-0000-0000-000000000061')->>'token',true) is not null;
reset role;
select is(public.read_public_proposal(current_setting('test.old_token')),null::jsonb,'Nova versão revoga link anterior sem resposta');
select is(public.respond_public_proposal(current_setting('test.negotiate_token'),'negotiate',null)->>'decision',
  'negotiate','Interesse em negociar persistido');
set local role authenticated;
select set_config('test.decline_token',public.issue_proposal(
  '22000000-0000-0000-0000-000000000061','44000000-0000-0000-0000-000000000061')->>'token',true) is not null;
reset role;
select is(public.respond_public_proposal(current_setting('test.decline_token'),'declined',true)->>'wantsRevision',
  'true','Recusa com solicitação de nova proposta persistida');
select is((select max(version) from public.commercial_proposals),4,'Versões recebem sequência por orçamento');
select is((select count(*) from public.commercial_proposals where decision is not null and notification_read_at is null),
  2::bigint,'Negociação e recusa aparecem na caixa de entrada');

set local role authenticated;
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000062';
select throws_ok($$select public.issue_proposal('22000000-0000-0000-0000-000000000061','44000000-0000-0000-0000-000000000061')$$,
  '42501',null,'Funcionário não emite proposta');
set local request.jwt.claim.sub = '11000000-0000-0000-0000-000000000063';
select is((select count(id) from public.commercial_proposals),0::bigint,'Outra empresa não lê propostas');
select * from finish();
rollback;
