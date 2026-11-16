# Calculadora de orçamentos — Fase 2.2

O PROMPT_MESTRE original descreve a Fase 1 e não especifica fórmulas financeiras. Este documento registra as decisões adotadas para a primeira versão.

| Etapa | Regra |
| --- | --- |
| Balões | No modo proporcional, multiplique o preço da embalagem pela quantidade usada e divida pela quantidade na embalagem. No modo integral, arredonde para cima o número de embalagens necessárias e multiplique pelo preço da embalagem. |
| Acervo | Use quantidade × custo de locação cadastrado como custo da linha. O acréscimo cadastrado incide sobre esse custo e compõe o preço de venda. Para itens próprios, a locação cadastrada representa o custo interno de uso definido pela empresa. |
| Materiais | Use custo cadastrado × quantidade consumida ÷ quantidade cadastrada, na mesma unidade. |
| Serviços e despesas | Some os custos informados para cada linha personalizada. |
| Transporte | Retirada tem custo zero. Valor fixo usa o custo informado. Por km usa a distância total informada × tarifa por km. |
| Mão de obra | Some o valor informado ao custo. |
| Formação do preço | Preço bruto = custo total + acréscimo do acervo + acréscimo global. O acréscimo global incide sobre o custo total. O percentual vem do padrão da empresa ou é informado para a composição atual. Sem percentual configurado, informe um antes de calcular o preço. |
| Desconto | Valor fixo ou percentual do preço bruto. O limite é o valor bruto ou 100%. |
| Resumo | Preço de venda = preço bruto − desconto. Lucro = preço de venda − custo total. Margem = lucro ÷ preço de venda. Venda zero tem margem indefinida. |

O motor usa inteiros de precisão arbitrária para centavos, centésimos de ponto percentual e quantidades escaladas. O arredondamento ocorre por linha e por ajuste, com meio centavo arredondado para cima em valores positivos. O desconto pode gerar prejuízo e o resumo sinaliza o resultado.

Funcionários podem selecionar produtos ativos e salvar ou editar sua composição. Administradores e proprietários podem revisar composições da empresa e usar as etapas financeiras. O rascunho salva nome, produtos e quantidades. Modo de embalagem, despesas, transporte, mão de obra, lucro específico e desconto pertencem à sessão de cálculo. O percentual padrão é persistido por empresa.
