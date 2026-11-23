/*
G5. RECEITA DIÁRIA COM MÉDIA MÓVEL E ACUMULADO
Pergunta: para cada dia do dataset, mostre:
  - receita do dia
  - média móvel de 7 dias
  - receita acumulada do mês
  - variação contra o mesmo dia da semana anterior (%)

Dicas:
- AVG(...) OVER (ORDER BY dia ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
- SUM(...) OVER (PARTITION BY mês ORDER BY dia)
- LAG(receita, 7)
- Pergunta extra: por que ROWS e não RANGE? O que acontece se faltar um dia?
*/









-- ======================== RESPOSTA ========================

with daily as (
    select
        parse_date('%Y%m%d', event_date)                 as day,
        sum(ecommerce.purchase_revenue_in_usd)           as revenue_usd
    from `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
    where _table_suffix between '20201101' and '20210131'
      and event_name = 'purchase'
    group by day
)
select
    day,
    revenue_usd,
    round(avg(revenue_usd) over (order by day rows between 6 preceding and current row), 2) as revenue_7d_moving_avg,
    sum(revenue_usd) over (partition by date_trunc(day, month) order by day)               as revenue_month_to_date,
    round(safe_divide(revenue_usd - lag(revenue_usd, 7) over (order by day),
                      lag(revenue_usd, 7) over (order by day)) * 100, 1)                   as pct_vs_same_weekday_last_week
from daily
order by day;

-- Resposta da pergunta extra: ROWS conta linhas; se um dia não tiver vendas, ele nem aparece
-- na tabela e "6 preceding" pega 7 linhas que cobrem mais de 7 dias. Para janelas de calendário
-- exatas, gere todas as datas com GENERATE_DATE_ARRAY e faça LEFT JOIN antes da janela.
