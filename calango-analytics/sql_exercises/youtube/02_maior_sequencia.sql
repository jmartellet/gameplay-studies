/*
Y2. GAPS AND ISLANDS: A MAIOR SEQUÊNCIA DE VÍDEOS DO MESMO JOGO
Pergunta: olhando os vídeos em ordem de publicação, qual foi a maior sequência
de vídeos seguidos do MESMO jogo (sem nenhum outro jogo no meio)?
Mostre jogo, tamanho da sequência, data de início e de fim.

Este é um padrão clássico de entrevista ("gaps and islands"):
1. Ordene os vídeos (channel_position: 0 = mais recente).
2. Marque com 1 toda linha em que o jogo MUDA em relação à anterior (LAG).
3. Uma soma acumulada dessas marcas cria um id para cada "ilha" de jogos iguais.
4. Agrupe pelo id da ilha.
*/









-- ======================== RESPOSTA ========================

with ordered as (
    select
        channel_position,
        game,
        approx_published_date,
        -- do mais antigo para o mais novo
        if(game = lag(game) over (order by channel_position desc), 0, 1) as is_new_island
    from `seu-projeto.dbt_seu_nome.fct_calango_videos`
    where content_type = 'Gameplay'
      and game != 'Não identificado'
),

islands as (
    select
        *,
        sum(is_new_island) over (order by channel_position desc rows between unbounded preceding and current row) as island_id
    from ordered
)

select
    game,
    count(*)                      as videos_in_a_row,
    min(approx_published_date)    as started,
    max(approx_published_date)    as ended
from islands
group by island_id, game
order by videos_in_a_row desc
limit 10;
