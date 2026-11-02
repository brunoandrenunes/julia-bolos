# Auditoria do sistema — 02/11/2026

Base analisada: cópia do banco de 01/11/2026 22:33 (backup `data/backups/bakery-system-antes-migracao-claude-20261102-113327.sqlite`, idêntico ao original no OneDrive).

## 1. Saúde do banco

- Integridade do SQLite: **ok**. Chaves estrangeiras: **nenhuma quebrada**.
- Compras ↔ estoque ↔ financeiro: **100% coerentes** (166 linhas de compra; nenhuma divergência de valor, quantidade, data, pagamento ou competência; nenhum lançamento órfão).
- Nenhum item com saldo negativo.
- Competências: jan–set/2026 fechadas; out/2026 aberta. Novembro ainda não existe.

| Tabela | Registros |
|---|---|
| Compras / linhas de compra | 89 / 166 |
| Entradas de estoque | 267 |
| Baixas de estoque | 251 |
| Lançamentos financeiros | 282 |
| Transferências | 9 |
| Itens (ativos / arquivados) | 69 / 39 |
| Fornecedores | 26 |

## 2. O que mudou desde a análise de 23/07

- Agosto a outubro: 69 compras pela aba Compras, todas com fornecedor; 49 com número de nota.
- **Idas ao fornecedor**: 13 dias de compra em agosto, 12 em setembro, 14 em outubro → cerca de **3 idas por semana**. A fragmentação continua: ovos (10 compras em 3 meses), nata (9), manteiga (7), açúcar (5), leite (5), óleo (4), Laka 80g (4).
- Compras grandes feitas em lote: leite condensado (270 latas em 22/07; 162 em 27/10) e creme de leite 1 kg (96 em 17/09). Saldo em 31/10: 155 latas de leite condensado (~1,7 mês de consumo) e 73 caixas de creme de leite 1 kg (~4 meses) — vale conferir validade.
- Troca de embalagem: creme de leite passou de caixinha 200 g para 1 kg a partir de julho.
- **Contagem de estoque**: não houve baixa em setembro; a contagem de 31/10 lançou o consumo de setembro + outubro juntos. Efeito: CMV de setembro = R$ 0 e CMV de outubro = R$ 5.466,64 (≈ dois meses). O ano consolidado continua correto. Setembro foi fechado sem contagem — o sistema não avisou.
- Receitas: desde agosto lançadas como total mensal (Pix + Dinheiro, 2 lançamentos/mês). Serve para a DRE, mas não para custo por bolo ou análise de vendas.

## 3. Problemas de uso (por que parece confuso)

1. Ao abrir o sistema sem escolher mês, o menu leva para **abril/2026** (valor fixo no código).
2. Tela Estoque mistura itens arquivados com ativos e marca 40 itens como "estoque baixo" — os mínimos são padrão (2 ou 5) e não foram definidos de verdade, então o alerta não significa nada.
3. Dois lugares para lançar entrada de estoque (Compras e Movimentações) — convida a lançar fora do fluxo de compras.
4. Listas de 69 itens e 26 fornecedores sem busca.
5. Cadastro com itens duplicados por unidade: Ovo (unidade × dúzia), Nata (300 g × kg), Creme de leite (200 g × lata × kg), Leite em pó (350 g × 380 g), Amido de milho × Maisena, Cream cheese (kg × 300 g), Doce de leite (kg × 350 g), Chocolate meio amargo (1 kg × 2 kg).
6. Textos de desenvolvimento esquecidos na tela (ex.: quadro "Decisão de produto") e acentos faltando.
7. Telas longas: formulário, filtros, tabela e explicações tudo na mesma página.

## 4. Problemas técnicos

- O banco é um arquivo lido e regravado inteiro a cada operação. Funciona em um computador, mas **não funciona em hospedagem web** (Vercel não guarda arquivos) e corre risco com OneDrive em dois computadores.
- `ignoreBuildErrors: true` no `next.config.ts` esconde erros de TypeScript no build (hoje o TypeScript passa sem erros).
- Sem senha: qualquer pessoa na mesma rede poderia abrir `localhost:3000` se a porta estivesse exposta.
- `lib/data.ts` concentra 2.700 linhas (cálculo, relatórios, gravação e regras) — difícil de manter.

## 5. Plano recomendado

1. **Migração para a web** (mesmo padrão do sistema de finanças pessoais): Supabase (banco + login com app autenticador) + Vercel + GitHub privado. Dados migrados sem alteração e conferidos mês a mês (quantidades, DRE, saldos, estoque).
2. **Arrumação**: mês atual como padrão, arquivados fora da tela principal, entrada de estoque só por Compras, busca nas listas, aviso ao fechar mês sem contagem.
3. **Parâmetros de reposição** só para os ~25 itens que somam 90% das compras (perecibilidade, validade, mínimo, alvo).
4. **Lista inteligente de compras** (saldo, consumo médio, cobertura em dias, urgência, confiança).
5. "Vale a pena?" e custo dos bolos depois que a base estiver confiável.
