-- One row per game: how much content it got and how it performed.

with videos as (

    select * from {{ ref('fct_calango_videos') }}
    where content_type = 'Gameplay'

),

by_game as (

    select
        game,
        any_value(genre)                                  as genre,
        count(*)                                          as videos,
        sum(views)                                        as total_views,
        approx_quantiles(views, 2)[offset(1)]             as median_views,
        round(sum(duration_sec) / 3600, 1)                as hours_of_content,
        min(approx_published_date)                        as first_video_date,
        max(approx_published_date)                        as last_video_date,
        countif(is_collab)                                as collab_videos
    from videos
    group by game

)

select
    *,
    safe_divide(total_views, hours_of_content)                     as views_per_hour_of_content,
    safe_divide(total_views, sum(total_views) over ())             as share_of_channel_views,
    rank() over (order by total_views desc)                        as rank_total_views,
    -- "efficiency" rank, only among games with enough videos to be meaningful
    if(videos >= 5, rank() over (partition by videos >= 5 order by median_views desc), null)
                                                                   as rank_median_views_min5
from by_game
