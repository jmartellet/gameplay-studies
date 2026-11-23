-- How audience drops (or grows) across the episodes of a series.
-- One row per episode of every series with at least var('min_series_episodes') numbered episodes.

with episodes as (

    select
        series_name,
        game,
        episode_number,
        video_id,
        title,
        views,
        approx_published_date,
        channel_position
    from {{ ref('fct_calango_videos') }}
    where content_type = 'Gameplay'
      and series_name is not null
      and episode_number is not null

),

-- some series reuse a number (re-uploads, "#3 parte 2"): keep one row per episode, the first upload
deduplicated as (

    select *
    from episodes
    where true
    qualify row_number() over (
        partition by series_name, episode_number
        order by channel_position desc
    ) = 1

),

eligible_series as (

    select series_name
    from deduplicated
    group by series_name
    having count(*) >= {{ var('min_series_episodes') }}
       and min(episode_number) = 1   -- we need episode 1 as the baseline

)

select
    d.*,
    row_number()  over w                                       as episode_order,
    count(*)      over (partition by d.series_name)            as series_episodes,
    first_value(d.views) over w                                as episode_1_views,
    lag(d.views)  over w                                       as previous_episode_views,
    safe_divide(d.views, first_value(d.views) over w)          as retention_vs_episode_1,
    safe_divide(d.views - lag(d.views) over w, lag(d.views) over w)
                                                               as change_vs_previous_episode
from deduplicated as d
inner join eligible_series using (series_name)
window w as (partition by d.series_name order by d.episode_number)
