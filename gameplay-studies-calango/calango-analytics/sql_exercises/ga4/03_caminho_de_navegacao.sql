/*
G3. CAMINHO DE NAVEGAÇÃO (window functions)
Pergunta: para cada sessão, liste as páginas na ordem em que foram vistas, com:
  - a posição da página na sessão (1, 2, 3...)
  - a página anterior e a próxima
  - quantos segundos o usuário ficou até a próxima pageview
  - a landing page (primeira página da sessão)
Depois: quais são as 10 transições "página A -> página B" mais comuns?

Dicas:
- Sessão = user_pseudo_id + ga_session_id.
- ROW_NUMBER(), LAG(), LEAD() e FIRST_VALUE() com
  OVER (PARTITION BY sessão ORDER BY event_timestamp).
- event_timestamp está em microssegundos: TIMESTAMP_MICROS() ou divida por 1e6.
*/









-- ======================== RESPOSTA ========================

with pageviews as (
    select
        concat(user_pseudo_id, '-', cast((select value.int_value from unnest(event_params) where key = 'ga_session_id') as string)) as session_key,
        event_timestamp,
        (select value.string_value from unnest(event_params) where key = 'page_title') as page_title
    from `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
    where _table_suffix = '20201215'
      and event_name = 'page_view'
),

paths as (
    select
        session_key,
        page_title,
        row_number()  over s                                       as page_position,
        lag(page_title)  over s                                    as previous_page,
        lead(page_title) over s                                    as next_page,
        (lead(event_timestamp) over s - event_timestamp) / 1e6     as seconds_until_next_page,
        first_value(page_title) over s                             as landing_page
    from pageviews
    window s as (partition by session_key order by event_timestamp)
)

-- 1) caminho detalhado (descomente para ver)
-- select * from paths order by session_key, page_position;

-- 2) transições mais comuns
select page_title as from_page, next_page as to_page, count(*) as transitions
from paths
where next_page is not null
  and page_title != next_page          -- ignora recarregamentos da mesma página
group by from_page, to_page
order by transitions desc
limit 10;
