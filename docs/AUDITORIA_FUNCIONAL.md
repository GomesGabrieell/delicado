# Auditoria funcional

Inventário inicial do código em `C:\appJulia`. A navegação usava React Navigation em um único arquivo. O projeto não tinha Expo Router nem configuração de lint. O ambiente local tinha apenas `.env.example`.

| Tela | Elementos interativos | Esperado | Comportamento encontrado | Problema e correção | Status |
| --- | --- | --- | --- | --- | --- |
| Dashboard e configuração | Atalhos, conta, configuração | Abrir módulos reais e orientar acesso | Atalhos sem Supabase abriam cartões descritivos | Removida a rota de demonstração. O painel explica quando a conexão está pendente | Corrigido no código |
| Login e conta | Entrar, sair, configurações | Autenticar e limpar rotas privadas ao sair | Chamadas Supabase implementadas | Rotas protegidas por sessão e configurações acessíveis | Implementado. Login e restauração precisam de projeto Auth configurado |
| Catálogo | Empresa, grupos, filtros, pesquisa, paginação, atualizar, novo, detalhes, editar, foto, categoria, salvar, arquivar, reativar, cancelar e voltar | CRUD real e uso na calculadora | CRUD e Storage implementados. Confirmação dependia de Alert nativo | Corrigida a confirmação web e adicionado o atalho para a calculadora | SQL verificado. Upload e uso em aparelho pendentes |
| Calculadora | Empresa, etapas, busca, paginação, adicionar, editar, remover, embalagem, despesas, transporte, mão de obra, lucro, desconto, salvar, abrir e reiniciar composição | Compor e levar itens e cálculo ao orçamento | Salvava composições e registrava cálculo se aberta por um orçamento | Criação de orçamento a partir do carrinho com transação única | SQL verificado. Aplicação no Supabase aguarda aprovação |
| Orçamentos | Empresa, novo, pesquisa, filtros, editar, cliente, salvar, calculadora, imagens, histórico, duplicar, estados, propostas e voltar | Persistir rascunho e abrir registros relacionados | Chamadas reais. Duplicação dependia de Alert nativo | Corrigidas confirmações de duplicação e arquivamento e ligadas rotas com parâmetros | SQL verificado. Jornada autenticada pendente |
| Clientes | Empresa, cadastro, edição, pesquisa, filtros, paginação, arquivar, reativar, histórico, abrir e criar orçamento | Persistir e manter vínculos | Chamadas reais. Arquivamento dependia de Alert nativo | Corrigida a confirmação e preservado o vínculo de cliente na rota de orçamento | SQL verificado. Jornada autenticada pendente |
| Propostas | Identidade, emissão, link, WhatsApp, PDF, filtros, leitura, revogação e voltar | Emitir, compartilhar e acompanhar respostas | RPC e função existentes. Página pública sem endereço configurado | Validar rotas e documentar dependências da publicação | Em verificação |
| Página pública | Aprovar, negociar, recusar, nova proposta, WhatsApp e PDF | Responder com token válido | Requisições reais. Endpoint vazio neste workspace | Configurar e publicar em ambiente autorizado | Pendente de configuração |
| Calendário e Financeiro | Nenhum | Acesso quando implementados | Módulos ausentes | Pendente de implementação | Pendente |

As listas e formulários existentes usam Supabase. Estado local é usado para filtros, edição e composição antes do salvamento. Nenhuma configuração de banco hospedado foi encontrada.

As rotas Expo Router ficam em `src/app/`. O painel oferece Catálogo, Calculadora, Orçamentos, Clientes e Propostas. O perfil permite sair e abrir Configurações. As telas usam a pilha para voltar entre módulos e seus botões internos para fechar formulários e detalhes. O projeto não tinha menu lateral ou abas inferiores.

Na web, a seleção de fotos usa os dados da imagem retornada pelo navegador. Android e iOS usam o sistema de arquivos do Expo. Catálogo e Orçamentos enviam o conteúdo ao Storage e aguardam a confirmação da gravação.

## Verificações executadas

- Painel, Configurações e retorno ao painel foram conferidos no navegador sem credenciais.
- O PostgreSQL descartável executou 139 asserções, incluindo sete da criação de orçamento pela calculadora. Elas verificam persistência da composição, rollback de rascunho inválido, permissão de funcionário e isolamento.
- Nove testes JavaScript passaram. TypeScript e a exportação Expo foram verificados. O lint passou com avisos de dependências de hooks usados para recarregar consultas. A configuração de lint permite iniciar o estado de carregamento dentro dos efeitos de consulta.
- Login real, persistência após reiniciar o aplicativo, cliques dos módulos autenticados, upload no Storage e envio de proposta ainda precisam do ambiente integrado. Não foram executados testes manuais em Android ou iOS.

## Validar em ambiente integrado

1. Após aprovação, aplique a migração `20261113000700_orcamento_da_calculadora.sql` no Supabase de desenvolvimento com as migrações anteriores. Configure URL e chave publicável no `.env` e prepare contas de proprietário, funcionário e outra empresa. Para Propostas, publique a função e a página conforme o README.
2. Entre, abra os atalhos do painel, volte de cada módulo e reabra o app para verificar a sessão.
3. Crie e edite um item no Catálogo. Abra seus detalhes e selecione **Usar na calculadora**. Confira a empresa e o item, informe o nome do orçamento, ajuste a composição e registre o cálculo pelo Resumo. Como funcionário, use **Criar orçamento com a composição**.
4. No orçamento aberto, vincule um cliente real. Reabra o orçamento após reiniciar o app, confira os itens e o cálculo registrado e abra o mesmo orçamento pelo histórico do cliente. Marque pronto para revisão e emita uma proposta como administrador.
5. Repita as consultas como funcionário e com uma conta de outra empresa. Confira as restrições de custos, edição e visibilidade.
