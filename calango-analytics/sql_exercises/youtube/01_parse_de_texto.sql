/*
Y1. TRANSFORMAR TEXTO EM NÚMERO
A coleta trouxe tudo como texto: "2:15:22", "3.9 thousand views", "2 years ago".
Pergunta: a partir do seed calango_videos_raw, crie as colunas
  - duration_min (número de minutos, com decimais)
  - views (inteiro)
  - age_amount e age_unit ("2" e "year")
e confira: quantos vídeos têm mais de 1 milhão de views? Qual a duração média em horas?

Dicas:
- SPLIT(duration, ':') devolve um array. ARRAY_LENGTH diz se é H:MM:SS ou MM:SS.
- REGEXP_EXTRACT(texto, r'^([\d.]+)') pega o número do começo.
- SAFE_CAST devolve NULL em vez de erro quando a conversão falha.
- Compare sua solução com models/youtube/staging/stg_calango__videos.sql.
*/









-- ======================== RESPOSTA ========================

with parsed as (
    select
        title,
        case array_length(split(duration, ':'))
            when 3 then cast(split(duration, ':')[offset(0)] as int64) * 60
                      + cast(split(duration, ':')[offset(1)] as int64)
                      + cast(split(duration, ':')[offset(2)] as int64) / 60
            else        cast(split(duration, ':')[offset(0)] as int64)
                      + cast(split(duration, ':')[offset(1)] as int64) / 60
        end                                                                  as duration_min,
        cast(round(safe_cast(regexp_extract(views_text, r'^([\d.]+)') as float64)
            * case when views_text like '%million%'  then 1000000
                   when views_text like '%thousand%' then 1000
                   else 1 end) as int64)                                     as views,
        safe_cast(regexp_extract(age_text, r'(\d+)') as int64)               as age_amount,
        regexp_extract(age_text, r'\d+ (day|week|month|year)')               as age_unit
    from `seu-projeto.dbt_seu_nome.calango_videos_raw`
)
select
    countif(views > 1000000)              as videos_over_1_million,
    round(avg(duration_min) / 60, 2)      as avg_duration_hours,
    count(*)                              as videos
from parsed;
