-- Channel output and performance per quarter.
-- Note: views are lifetime totals, so older quarters had more time to accumulate views.
-- Dates for videos older than a year are estimated (see int_calango__videos_dated).

with quarterly as (

    select
        published_quarter,
        count(*)                                                 as videos,
        round(sum(duration_sec) / 3600, 1)                       as hours_published,
        sum(views)                                               as total_views,
        approx_quantiles(views, 2)[offset(1)]                    as median_views,
        countif(content_type = 'Gameplay')                       as gameplay_videos,
        countif(content_type = 'React')                          as react_videos,
        count(distinct game)                                     as distinct_games,
        countif(title_case = 'CAIXA ALTA')                       as all_caps_titles
    from {{ ref('fct_calango_videos') }}
    group by published_quarter

)

select
    *,
    sum(videos) over (order by published_quarter)                                as cumulative_videos,
    avg(median_views) over (order by published_quarter rows between 3 preceding and current row)
                                                                                  as median_views_4q_moving_avg,
    safe_divide(median_views - lag(median_views, 4) over (order by published_quarter),
                lag(median_views, 4) over (order by published_quarter))           as median_views_yoy_change
from quarterly
