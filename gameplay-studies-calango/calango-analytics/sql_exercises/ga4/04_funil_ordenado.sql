/*
G4. FUNIL FECHADO (em ordem)
Pergunta: das sessões de janeiro de 2021, quantas passaram por
view_item -> add_to_cart -> begin_checkout -> purchase NESSA ORDEM?
Mostre a taxa de passagem de cada etapa para a seguinte.

Por que importa: o funil "aberto" (models/ga4/marts/fct_funnel_daily.sql)
conta cada etapa de forma independente. Uma sessão que comprou sem ver o produto
na mesma sessão entra em "purchase" mas não em "view_item". O funil fechado exige ordem.

Dicas:
- Pegue o MIN(event_timestamp) de cada etapa por sessão (MIN(IF(event_name = ..., ts, NULL))).
- Uma etapa só conta se o timestamp dela for maior que o da etapa anterior.
*/









-- ======================== RESPOSTA ========================

with steps as (
    select
        concat(user_pseudo_id, '-', cast((select value.int_value from unnest(event_params) where key = 'ga_session_id') as string)) as session_key,
        min(if(event_name = 'view_item',      event_timestamp, null)) as ts_view_item,
        min(if(event_name = 'add_to_cart',    event_timestamp, null)) as ts_add_to_cart,
        min(if(event_name = 'begin_checkout', event_timestamp, null)) as ts_begin_checkout,
        min(if(event_name = 'purchase',       event_timestamp, null)) as ts_purchase
    from `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
    where _table_suffix between '20210101' and '20210131'
    group by session_key
),

ordered as (
    select
        ts_view_item is not null                                                    as s1,
        ts_view_item is not null and ts_add_to_cart > ts_view_item                  as s2,
        ts_view_item is not null and ts_add_to_cart > ts_view_item
            and ts_begin_checkout > ts_add_to_cart                                  as s3,
        ts_view_item is not null and ts_add_to_cart > ts_view_item
            and ts_begin_checkout > ts_add_to_cart and ts_purchase > ts_begin_checkout as s4
    from steps
)

select
    countif(s1) as view_item,
    countif(s2) as add_to_cart,
    countif(s3) as begin_checkout,
    countif(s4) as purchase,
    round(safe_divide(countif(s2), countif(s1)), 4) as view_to_cart,
    round(safe_divide(countif(s3), countif(s2)), 4) as cart_to_checkout,
    round(safe_divide(countif(s4), countif(s3)), 4) as checkout_to_purchase,
    round(safe_divide(countif(s4), countif(s1)), 4) as overall_conversion
from ordered;
