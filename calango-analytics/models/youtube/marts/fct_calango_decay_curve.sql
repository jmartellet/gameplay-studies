-- The "typical" series: median retention vs episode 1 at each episode number.
-- Good for a single line chart: "by episode 5, a series keeps X% of episode 1's audience".

select
    episode_number,
    count(*)                                                  as series_with_this_episode,
    approx_quantiles(retention_vs_episode_1, 2)[offset(1)]    as median_retention_vs_episode_1,
    approx_quantiles(retention_vs_episode_1, 4)[offset(1)]    as p25_retention,
    approx_quantiles(retention_vs_episode_1, 4)[offset(3)]    as p75_retention
from {{ ref('fct_calango_series_decay') }}
where episode_number <= 20
group by episode_number
having count(*) >= 5
