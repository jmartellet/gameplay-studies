-- One row per video with every attribute used in the analysis:
-- series, game, genre, episode number, format flags and title style.

with videos as (

    select * from {{ ref('int_calango__videos_dated') }}

),

aliases as (

    select * from {{ ref('calango_game_aliases') }}

),

extracted as (

    select
        *,
        upper(title) as title_upper,

        -- Series name, from the two title formats the channel has used over time:
        --   old: "CALANGO JOGANDO ELDEN RING NO VOLANTE #25"
        --   new: "olha so essa geometria | GTA VI #5"
        coalesce(
            regexp_extract(
                upper(title),
                r'^\d?CALANGO(?: E [\p{L} ]+?)?(?: VS [\p{L} ]+? EM:)? (?:JOGANDO:?|JOGA|TENTANDO PLATINAR(?: O| A)?|TENTANDO FAZER SPEEDRUN DE|VOLTANDO A JOGAR) (.+)$'
            ),
            regexp_extract(upper(title), r'\|([^|]*)$')
        ) as series_raw
    from videos

),

cleaned as (

    select
        *,
        -- drop episode markers and anything after them: "#5", "(2/5)", " - PARTE 2", "EP.100"
        nullif(trim(regexp_replace(series_raw, r'\s*(#|\(| - |\bPARTE\b|\bEP\.).*$', '')), '') as series_name,

        coalesce(
            safe_cast(regexp_extract(title, r'#\s*(\d+)') as int64),
            safe_cast(regexp_extract(title, r'\((\d+)/\d+\)') as int64),
            safe_cast(regexp_extract(upper(title), r'PARTE\s*(\d+)') as int64),
            safe_cast(regexp_extract(upper(title), r'EP\.?\s*(\d+)') as int64)
        ) as episode_number,

        regexp_contains(upper(title), r'#\s*FINAL|\(FINAL\)') as is_series_finale
    from extracted

),

alias_matches as (

    -- first alias (lowest priority number) whose pattern appears in the title.
    -- BigQuery only allows non-equality join conditions in INNER/CROSS joins,
    -- so the match is resolved here and LEFT JOINed back by video_id below.
    select
        c.video_id,
        a.game  as alias_game,
        a.genre as alias_genre
    from cleaned as c
    inner join aliases as a
        on regexp_contains(c.title_upper, a.pattern)
    where true  -- some BigQuery versions require WHERE/GROUP BY/HAVING next to QUALIFY
    qualify row_number() over (partition by c.video_id order by a.priority) = 1

),

with_game as (

    select
        c.*,
        m.alias_game,
        m.alias_genre
    from cleaned as c
    left join alias_matches as m using (video_id)

)

select
    video_id,
    channel_position,
    title,
    approx_published_date,
    date_trunc(approx_published_date, quarter)                                  as published_quarter,
    extract(year from approx_published_date)                                    as published_year,
    is_date_precise_to_month,

    views,
    duration_sec,
    round(duration_sec / 60, 1)                                                 as duration_min,
    case
        when duration_sec <  30 * 60 then '1. < 30 min'
        when duration_sec <  60 * 60 then '2. 30-60 min'
        when duration_sec < 120 * 60 then '3. 1-2 h'
        when duration_sec < 180 * 60 then '4. 2-3 h'
        else                              '5. 3 h+'
    end                                                                         as duration_bucket,

    case
        when regexp_contains(title_upper, r'^\d?CALANGO (REAGINDO|ASSISTINDO|VENDO)') then 'React'
        when series_name is not null or alias_game is not null                       then 'Gameplay'
        else 'Outro'
    end                                                                         as content_type,

    series_name,
    coalesce(
        alias_game,
        -- unmapped games: series name without "com os amigos", "com mods"...
        initcap(regexp_replace(series_name, r'\s+COM\s+(OS\s+|O\s+|A\s+)?(AMIGOS|CHAT|MODS)\b.*$', '')),
        'Não identificado'
    )              as game,
    coalesce(alias_genre, 'Outros')                                             as genre,
    episode_number,
    is_series_finale,

    -- format flags
    regexp_contains(title_upper, r'AMIGOS|FEAT|FELPS|ALANZOKA|CELLBIT|COM ZERO|E ZERO|COM MOUNT|TURMA')
                                                                                as is_collab,
    regexp_contains(title_upper, r'\bMAS\b|VOLANTE|VIOL[AÃ]O|BATERIA|TAPETE DE DAN|RANDOMIZ|ALEAT[OÓ]RI|SPEEDRUN|PLATIN|ESTEIRA|A CADA')
                                                                                as is_challenge,

    -- title style
    case
        when title = upper(title) then 'CAIXA ALTA'
        when title = lower(title) then 'minúsculas'
        else 'Misto'
    end                                                                         as title_case,
    strpos(title, '|') > 0                                                      as title_has_pipe,
    strpos(title, '?') > 0                                                      as title_has_question,
    regexp_contains(title, r'[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]')           as title_has_emoji,
    length(title)                                                               as title_length
from with_game
