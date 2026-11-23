-- The estimated publish date must fall inside the interval implied by "N units ago",
-- and must respect the channel order (a newer position can never have an older date).

with dated as (

    select * from {{ ref('int_calango__videos_dated') }}

),

out_of_bounds as (

    select video_id, 'outside age interval' as problem
    from dated
    where approx_published_date not between oldest_possible_date and newest_possible_date

),

out_of_order as (

    select video_id, 'older than the next video on the page' as problem
    from (
        select
            video_id,
            approx_published_date,
            lead(approx_published_date) over (order by channel_position) as next_older_video_date
        from dated
    )
    where approx_published_date < next_older_video_date

)

select * from out_of_bounds
union all
select * from out_of_order
