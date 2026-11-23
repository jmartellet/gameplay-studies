-- The channel page only shows relative ages ("2 years ago"), so the publish date is estimated.
--
-- "N units ago" means the video was published between (N+1) and N units before the snapshot.
-- Videos on the page are ordered newest -> oldest, so inside each age bucket the videos are
-- spread evenly across that interval, keeping the original order.

with videos as (

    select * from {{ ref('stg_calango__videos') }}

),

bounds as (

    select
        *,
        case age_unit
            when 'day'   then date_sub(date '{{ var("youtube_snapshot_date") }}', interval age_amount day)
            when 'week'  then date_sub(date '{{ var("youtube_snapshot_date") }}', interval age_amount week)
            when 'month' then date_sub(date '{{ var("youtube_snapshot_date") }}', interval age_amount month)
            when 'year'  then date_sub(date '{{ var("youtube_snapshot_date") }}', interval age_amount year)
        end as newest_possible_date,
        case age_unit
            when 'day'   then date_sub(date '{{ var("youtube_snapshot_date") }}', interval (age_amount + 1) day)
            when 'week'  then date_sub(date '{{ var("youtube_snapshot_date") }}', interval (age_amount + 1) week)
            when 'month' then date_sub(date '{{ var("youtube_snapshot_date") }}', interval (age_amount + 1) month)
            when 'year'  then date_sub(date '{{ var("youtube_snapshot_date") }}', interval (age_amount + 1) year)
        end as oldest_possible_date
    from videos

),

ranked as (

    select
        *,
        row_number() over (partition by age_text order by channel_position) as position_in_bucket,
        count(*)     over (partition by age_text)                           as bucket_size
    from bounds

),

interpolated as (

    select
        * except (position_in_bucket, bucket_size),
        date_sub(
            newest_possible_date,
            interval cast(round(
                date_diff(newest_possible_date, oldest_possible_date, day)
                * (position_in_bucket - 0.5) / bucket_size
            ) as int64) day
        ) as interpolated_date
    from ranked

)

select
    * except (interpolated_date),
    -- Buckets can overlap ("4 weeks ago" vs "1 month ago"). A running minimum guarantees that
    -- a video further down the page is never dated after a video above it.
    min(interpolated_date) over (
        order by channel_position
        rows between unbounded preceding and current row
    )                                                         as approx_published_date,
    age_unit in ('day', 'week', 'month')                      as is_date_precise_to_month
from interpolated
