# Modelo multiempresa proposto

**Estado** — modelo aprovado para implementação e testes locais. A implantação no Supabase hospedado aguarda aprovação específica.

## Entidades

| Entidade | Chave e campos principais | Finalidade |
| --- | --- | --- |
| `auth.users` | `id` UUID | Identidade gerenciada pelo Supabase Auth. |
| `public.profiles` | `user_id` UUID, `display_name` | Perfil privado. `user_id` é PK e FK para `auth.users`. O perfil pode ser criado no primeiro uso. |
| `public.companies` | `id` UUID, `name`, `created_at` | Cadastro da empresa. |
| `public.company_members` | `company_id`, `user_id`, `role`, `status`, `created_at` | PK composta e FKs para empresa e usuário. Papéis por vínculo e status `active` ou `revoked`. Índice por usuário para localizar seus vínculos. |
| `private.role_permissions` | `role`, `permission` | PK composta. Mapeamento fixo administrado por migração, em schema fora da Data API. |

Cada usuário pode participar de várias empresas com papéis distintos. O vínculo revogado preserva seu histórico mínimo e deixa de conceder acesso após o commit, inclusive com uma sessão Auth ainda válida. A remoção física de usuários referenciados por vínculos exige um fluxo administrativo que preserve a existência de um proprietário ativo.

## Papéis propostos

| Permissão | Proprietário (`owner`) | Administrador (`admin`) | Membro (`member`) |
| --- | --- | --- | --- |
| Ler empresa e o próprio vínculo ativo | Sim | Sim | Sim |
| Listar vínculos ativos da empresa | Sim | Sim | — |
| Alterar nome da empresa | Sim | Sim | — |
| Ativar e revogar membros comuns | Sim | Sim | — |
| Atribuir ou revogar o papel de administrador | Sim | — | — |
| Atribuir ou revogar o papel de proprietário | Sim | — | — |

Cada operação usa a identidade retornada por `auth.uid()` e verifica o papel e o status no banco para a empresa da operação.

## RLS, grants e operações de escrita

| Tabela | Leitura por `authenticated` | Escrita por `authenticated` |
| --- | --- | --- |
| `profiles` | Apenas o próprio perfil. | Inserir apenas com o próprio `user_id` e atualizar apenas `display_name` do próprio perfil, com RLS e grants por coluna. |
| `companies` | Apenas linhas com vínculo ativo. | Criação e edição por RPC. |
| `company_members` | Vínculos ativos do próprio usuário. Proprietários e administradores podem também consultar os demais vínculos ativos da mesma empresa. | Alterações por RPC. |
| `role_permissions` | Acesso interno aos verificadores de autorização. | Gerenciada pela migração. |

- Habilitar RLS em todas as tabelas do modelo e conceder apenas os privilégios necessários. O papel `anon` fica sem acesso às tabelas e sem permissão para executar as operações de negócio. Validar também o comportamento do login anônimo do Supabase e mantê-lo desativado nesta fase.
- Usar verificadores em schema privado para evitar recursão na política de `company_members`. As funções `SECURITY DEFINER` terão `search_path` fixo, referências qualificadas, proprietário controlado e privilégios de execução explícitos. As RPCs expostas serão restritas a `authenticated` e validarão a autorização em cada chamada.
- `create_company(p_name)` cria a empresa e associa `auth.uid()` como proprietário na mesma transação. Qualquer usuário autenticado com conta regular pode criar uma empresa na proposta inicial.
- `rename_company(p_company_id, p_name)` verifica o vínculo e a permissão na empresa de destino. IDs enviados pelo cliente servem para identificar o alvo da operação.
- `set_company_member(p_company_id, p_user_id, p_role, p_status)` opera apenas sobre usuários existentes. Valida o papel atual e o papel solicitado para impedir escalada ou remoção de proprietários e administradores por um administrador. O fluxo de convite e a descoberta de usuários ficam para definição posterior.
- Operações sobre vínculos e operações administrativas que dependam deles adquirem o bloqueio da mesma linha da empresa antes de verificar permissões. Desse modo, revogação e rebaixamento são serializados e a última associação ativa de proprietário é preservada. Revogação e rebaixamento do último proprietário retornam `23514`. Acesso negado retorna `42501`.
- Os módulos futuros devem associar seus registros à empresa e verificar RLS nas leituras e escritas. Quando houver relação entre dois registros da mesma empresa, a integridade referencial deve impedir vínculos cruzados.

## Verificação

A suíte em [`supabase/tests/tenant_isolation.test.sql`](../supabase/tests/tenant_isolation.test.sql) usa duas empresas, usuários de teste e papéis de requisição em uma transação revertida. A suíte verifica as tabelas, RPCs e códigos SQLSTATE da fundação implementada.

Referências [RLS no Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) e [testes RLS com pgTAP](https://supabase.com/docs/guides/database/postgres/testing-row-level-security).
