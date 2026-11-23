/*
G2. PÁGINAS MAIS VISTAS
Pergunta: quais as 20 páginas (page_title) com mais pageviews em dezembro de 2020,
quantos usuários únicos viram cada uma e qual a média de pageviews por usuário?

Dicas:
- Use uma subquery escalar para tirar um parâmetro sem multiplicar as linhas:
  (select value.string_value from unnest(event_params) where key = 'page_title')
- Compare com o exercício G1: lá o UNNEST no FROM gerava uma linha por parâmetro.
  Aqui queremos continuar com uma linha por evento.
*/









-- ======================== RESPOSTA ========================

with pageviews as (
    select
        user_pseudo_id,
        (select value.string_value from unnest(event_params) where key = 'page_title') as page_title
    from `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
    where _table_suffix between '20201201' and '20201231'
      and event_name = 'page_view'
)
select
    page_title,
    count(*)                                                   as pageviews,
    count(distinct user_pseudo_id)                             as users,
    round(count(*) / count(distinct user_pseudo_id), 2)        as pageviews_per_user
from pageviews
group by page_title
order by pageviews desc
limit 20;
