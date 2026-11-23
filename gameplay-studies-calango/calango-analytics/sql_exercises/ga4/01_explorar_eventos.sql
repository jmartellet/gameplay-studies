/*
G1. EXPLORAR OS EVENTOS
Pergunta: quais eventos existem no dataset, quantas vezes cada um aparece
e quais parâmetros (event_params) cada evento carrega?

Dicas:
- event_params é um ARRAY de STRUCT<key, value>. Para "abrir" o array, use UNNEST.
- Cada parâmetro guarda o valor em UM de quatro campos:
  value.string_value, value.int_value, value.float_value, value.double_value.
  Ler o campo errado devolve NULL sem erro nenhum.
- Filtre um único dia (_table_suffix = '20210101') para a query sair barata.
*/









-- ======================== RESPOSTA ========================

-- 1) Volume por evento
select event_name, count(*) as events, count(distinct user_pseudo_id) as users
from `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
where _table_suffix = '20210101'
group by event_name
order by events desc;

-- 2) Quais chaves cada evento tem, e em qual campo o valor está guardado
select
    event_name,
    p.key,
    count(*)                                     as occurrences,
    countif(p.value.string_value is not null)    as as_string,
    countif(p.value.int_value    is not null)    as as_int,
    countif(p.value.double_value is not null)    as as_double
from `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`,
    unnest(event_params) as p          -- a vírgula aqui é um CROSS JOIN com o array
where _table_suffix = '20210101'
group by event_name, p.key
order by event_name, occurrences desc;
