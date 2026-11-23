-- For every converting session, list all sessions of the same user in the
-- lookback window (inclusive), ordered in time. Base for attribution models.

with sessions as (

    select session_key, user_pseudo_id, session_start_ts, channel, reached_purchase, revenue_usd
    from {{ ref('fct_sessions') }}

),

conversions as (

    select
        session_key        as conversion_session_key,
        user_pseudo_id,
        session_start_ts   as conversion_ts,
        revenue_usd        as conversion_revenue_usd
    from sessions
    where reached_purchase

),

touchpoints as (

    select
        c.conversion_session_key,
        c.conversion_ts,
        c.conversion_revenue_usd,
        s.session_key,
        s.session_start_ts,
        s.channel
    from conversions as c
    inner join sessions as s
        on  s.user_pseudo_id = c.user_pseudo_id
        and s.session_start_ts between
                timestamp_sub(c.conversion_ts, interval {{ var('attribution_lookback_days') }} day)
                and c.conversion_ts

)

select
    *,
    row_number() over (partition by conversion_session_key order by session_start_ts, session_key) as touch_position,
    count(*)     over (partition by conversion_session_key)                                         as touch_count
from touchpoints
