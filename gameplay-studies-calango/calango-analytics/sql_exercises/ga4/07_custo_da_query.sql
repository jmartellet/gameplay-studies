/*
G7. CUSTO E PERFORMANCE (o "tuning" que as vagas pedem)
No BigQuery você paga pelos BYTES LIDOS, não pelo tempo. Antes de rodar, o editor
mostra no canto direito "Esta consulta processará X MB". Compare as quatro versões
abaixo SEM rodar, só olhando a estimativa, e anote o volume de cada uma.

Perguntas:
1. Por que a versão A lê muito mais que a B, se as duas devolvem o mesmo resultado?
2. Por que LIMIT não reduz o custo (versão C)?
3. O que o filtro em _table_suffix faz (versão D)? Qual o equivalente numa tabela particionada por data?
4. Num modelo dbt que roda todo dia, onde vale materializar como tabela em vez de view?
*/

-- A) select * : lê TODAS as colunas, inclusive arrays pesados (event_params, items)
select *
from `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
where event_name = 'purchase';

-- B) só as colunas necessárias
select event_date, user_pseudo_id, ecommerce.purchase_revenue_in_usd
from `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
where event_name = 'purchase';

-- C) LIMIT não reduz a leitura: a tabela inteira é varrida antes de cortar as linhas
select event_date, user_pseudo_id
from `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
limit 10;

-- D) filtrar shards (ou partições) é o que realmente reduz a leitura
select event_date, user_pseudo_id, ecommerce.purchase_revenue_in_usd
from `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
where _table_suffix between '20210101' and '20210107'
  and event_name = 'purchase';









-- ======================== RESPOSTA ========================
/*
1. O BigQuery é colunar: só lê as colunas citadas. SELECT * traz os arrays aninhados,
   que são a maior parte do volume.
2. LIMIT corta o resultado depois que os dados já foram lidos. Para amostrar barato,
   use TABLESAMPLE SYSTEM (1 PERCENT) ou filtre partições.
3. _table_suffix restringe quais tabelas diárias (shards) entram na leitura.
   Numa tabela particionada, o equivalente é filtrar a coluna de partição
   (ex.: WHERE event_date BETWEEN ...). Clustering (ex.: por event_name) reduz
   ainda mais quando o filtro usa as colunas clusterizadas.
4. Em modelos lidos por muitos outros ou por dashboards (staging pesado, marts),
   materializar como tabela evita reprocessar a origem a cada consulta. Em produção,
   modelos incrementais (que só processam os dias novos) reduzem o custo diário.
*/
