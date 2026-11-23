/*
Y4. COMPARAR PERÍODOS: ATÉ 2024 x A PARTIR DE 2025
Em 2025 o canal trocou os títulos "CALANGO JOGANDO X #N" (caixa alta) por
"frase | jogo #N". Pergunta: para os jogos que aparecem NOS DOIS períodos,
como a mediana de views mudou de um para o outro?

Dicas:
- Uma linha por jogo, com uma coluna por período: agregação condicional,
  ex. APPROX_QUANTILES(IF(condição, views, NULL), 2)[OFFSET(1)].
  (APPROX_QUANTILES ignora NULLs.)
- COUNTIF para garantir um mínimo de vídeos em cada estilo.
- SAFE_DIVIDE evita erro de divisão por zero.
- Cuidado ao concluir: views são acumuladas, e os vídeos antigos tiveram mais tempo.
*/









-- ======================== RESPOSTA ========================

with by_game as (
    select
        game,
        countif(published_year <= 2024)                                             as videos_until_2024,
        countif(published_year >= 2025)                                             as videos_since_2025,
        approx_quantiles(if(published_year <= 2024, views, null), 2)[offset(1)]     as median_views_until_2024,
        approx_quantiles(if(published_year >= 2025, views, null), 2)[offset(1)]     as median_views_since_2025
    from `seu-projeto.dbt_seu_nome.fct_calango_videos`
    where content_type = 'Gameplay'
      and game != 'Não identificado'
    group by game
)
select
    *,
    round(safe_divide(median_views_since_2025, median_views_until_2024), 2) as since_2025_vs_until_2024
from by_game
where videos_until_2024 >= 3
  and videos_since_2025 >= 3
order by since_2025_vs_until_2024 desc;
