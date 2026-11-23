/*
Y3. O EPISÓDIO MAIS VISTO DE CADA SÉRIE
Pergunta: em cada série com 5+ episódios, qual episódio teve mais views?
Em quantas séries o campeão NÃO é o episódio 1?
E, para cada episódio, em que percentil de views ele está dentro da sua série?

Dicas:
- QUALIFY ROW_NUMBER() OVER (PARTITION BY série ORDER BY views DESC) = 1
- PERCENT_RANK() OVER (PARTITION BY série ORDER BY views) vai de 0 (pior) a 1 (melhor).
- Use a tabela fct_calango_series_decay, que já filtra séries longas.
*/









-- ======================== RESPOSTA ========================

-- 1) episódio campeão de cada série
select
    series_name,
    episode_number   as best_episode,
    views,
    series_episodes
from `seu-projeto.dbt_seu_nome.fct_calango_series_decay`
where true
qualify row_number() over (partition by series_name order by views desc) = 1
order by views desc;

-- 2) quantas séries têm um campeão que não é o episódio 1
with best as (
    select series_name, episode_number
    from `seu-projeto.dbt_seu_nome.fct_calango_series_decay`
    where true
    qualify row_number() over (partition by series_name order by views desc) = 1
)
select
    countif(episode_number = 1)  as series_where_episode_1_wins,
    countif(episode_number != 1) as series_where_another_episode_wins
from best;

-- 3) percentil de cada episódio dentro da série
select
    series_name,
    episode_number,
    views,
    round(percent_rank() over (partition by series_name order by views), 2) as percentile_in_series
from `seu-projeto.dbt_seu_nome.fct_calango_series_decay`
order by series_name, episode_number;
