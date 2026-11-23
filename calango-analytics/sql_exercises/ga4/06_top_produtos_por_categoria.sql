/*
G6. TOP 3 PRODUTOS POR CATEGORIA
Pergunta: em cada item_category, quais os 3 produtos com mais receita?
Mostre também a participação de cada produto na receita da categoria.

Dicas:
- Os produtos estão no array `items` dos eventos de purchase: UNNEST(items).
- RANK() OVER (PARTITION BY categoria ORDER BY receita DESC)
- QUALIFY filtra pelo resultado de uma window function, sem precisar de subquery.
- Participação: receita / SUM(receita) OVER (PARTITION BY categoria)
*/









-- ======================== RESPOSTA ========================

with item_revenue as (
    select
        i.item_category,
        i.item_name,
        sum(i.item_revenue_in_usd) as revenue_usd,
        sum(i.quantity)            as units
    from `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`,
        unnest(items) as i
    where _table_suffix between '20201101' and '20210131'
      and event_name = 'purchase'
      and i.item_category not in ('(not set)', '')
    group by i.item_category, i.item_name
)
select
    item_category,
    item_name,
    revenue_usd,
    units,
    rank() over (partition by item_category order by revenue_usd desc)                         as rank_in_category,
    round(revenue_usd / sum(revenue_usd) over (partition by item_category) * 100, 1)           as pct_of_category
from item_revenue
where true
qualify rank_in_category <= 3
order by item_category, rank_in_category;
