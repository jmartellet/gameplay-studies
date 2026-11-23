# Guia passo a passo (só navegador, nada para instalar)

Tempo estimado de configuração: 1 a 2 horas. Tudo gratuito.

## 1. BigQuery (sandbox)

1. Acesse **console.cloud.google.com/bigquery** com sua conta Google.
2. Crie um projeto (ex.: `portfolio-juliana`). O modo **sandbox** é ativado automaticamente, sem cartão de crédito.
3. Anote o **ID do projeto**: aparece ao lado do nome, às vezes com números no final.
4. Teste com esta query:
   ```sql
   select count(*) as eventos, count(distinct user_pseudo_id) as usuarios
   from `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
   ```

**Limites do sandbox:** 10 GB de armazenamento, 1 TB de consulta por mês e tabelas que expiram em 60 dias. Se as tabelas sumirem, basta rodar `dbt build` de novo. O sandbox não permite `MERGE`/`INSERT`, por isso todos os modelos são `table`.

## 2. GitHub

O projeto fica na pasta `calango-analytics/` do repositório **jmartellet/gameplay-studies**. O dbt Cloud e o Colab leem direto de lá.

## 3. Conta de serviço (para o dbt acessar o BigQuery)

1. No console do Google Cloud: **IAM e administrador → Contas de serviço → Criar conta de serviço**.
2. Nome: `dbt`. Papéis: **BigQuery Data Editor** e **BigQuery Job User**.
3. Abra a conta criada → **Chaves → Adicionar chave → JSON**. Um arquivo é baixado.

⚠️ **Essa chave é uma senha.** Ela vai só para o dbt Cloud, nunca para o GitHub. Depois do passo 4, você pode apagar o arquivo do computador.

## 4. dbt Cloud

1. Crie uma conta em **getdbt.com** (plano gratuito *Developer*, 1 usuário).
2. Novo projeto → conexão **BigQuery** → envie o JSON da chave. Em **Location**, use **US**: o dataset público fica nos EUA e os dois precisam estar na mesma região.
3. Repositório: conecte o GitHub e escolha `gameplay-studies`. Em **Project subdirectory**, informe `calango-analytics` (o `dbt_project.yml` fica nessa pasta, não na raiz).
4. Em *Development credentials*, defina o dataset (ex.: `dbt_juliana`). É onde as tabelas vão ser criadas.
5. Abra o **IDE** (Studio) e rode, na barra de comandos:
   ```
   dbt build
   ```
   Esse comando carrega os seeds (dados do canal), cria todos os modelos e roda todos os testes. Se algo falhar, a mensagem de erro do BigQuery aparece no log; me mande o erro que eu ajudo.
6. Confira no BigQuery: o dataset `dbt_juliana` deve ter `fct_sessions`, `fct_calango_videos` etc.

Para rodar só um módulo: `dbt build --select tag:youtube` ou `dbt build --select tag:ga4`.

## 5. Notebooks no Colab

1. No README do projeto, clique no botão **Open in Colab**, ou acesse **colab.research.google.com** → **GitHub** → `jmartellet/gameplay-studies`.
2. `calango_channel_analysis.ipynb`: rode tudo (Ambiente de execução → Executar tudo). Funciona sem BigQuery, lendo os CSVs da pasta `calango-analytics/data/`.
3. `ga4_ab_test.ipynb`: troque `PROJECT_ID` pelo ID do passo 1 e rode. O Colab vai pedir permissão para acessar sua conta Google.
4. Para salvar o notebook executado no GitHub, com gráficos: **Arquivo → Salvar uma cópia no GitHub**.

## 6. Dashboard no Looker Studio

Siga o roteiro em [`docs/dashboard.md`](docs/dashboard.md). No final, **Compartilhar → Qualquer pessoa com o link pode ver** e cole o link no topo do `calango-analytics/README.md`.

## 7. Fechamento do portfólio

- [ ] Reescrever a seção *Principais achados* do README com suas palavras (é um rascunho)
- [ ] Rodar o módulo GA4 e, se quiser, acrescentar os achados dele no README
- [ ] Escrever as conclusões nas células finais dos dois notebooks
- [ ] Colocar um print do dashboard no README
- [ ] Adicionar o link do repositório no LinkedIn (seção Projetos) e no currículo

## Ordem de estudo sugerida (4 semanas)

| Semana | Foco | O que fazer |
|---|---|---|
| 1 | SQL + BigQuery | Exercícios G1 a G4 e Y1. Ler `stg_ga4__events` e `fct_sessions` linha a linha. |
| 2 | Window functions + dbt | Exercícios G5, G6, Y2, Y3. Montar o projeto no dbt Cloud, rodar `dbt build`, ler os testes. |
| 3 | Estatística + Python | Notebook de A/B (rodar, mudar `TRUE_RELATIVE_LIFT` para 0 e ver o que acontece). Notebook do Calango. |
| 4 | Dashboard + narrativa | Looker Studio, exercício G7 (custo), README final e explicar o projeto em voz alta em 3 minutos. |

## Como falar do projeto em entrevista

- **O problema:** "Queria praticar o ciclo completo: dado bruto, modelagem, teste e comunicação."
- **Uma decisão técnica:** a estimativa de data a partir de "há 2 anos" e o teste que garante que a ordem dos vídeos é respeitada; ou a regra do BigQuery que não aceita `LEFT JOIN` só com condição de regex.
- **Um cuidado estatístico:** o exemplo do título em caixa alta, que parecia pior mas era efeito da época.
- **Uma limitação honesta:** views acumuladas e dados observacionais. Como você testaria de verdade: A/B de título ou thumbnail.
