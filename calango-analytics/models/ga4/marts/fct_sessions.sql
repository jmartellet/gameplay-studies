-- One row per session: traffic source, landing page, engagement, and how far into the funnel it went.

with events as (

    select *
    from {{ ref('stg_ga4__events') }}
    where ga_session_id is not null

),

sessions as (

    select
        session_key,
        any_value(user_pseudo_id)                                                    as user_pseudo_id,
        min(event_date)                                                              as session_date,
        min(event_ts)                                                                as session_start_ts,
        max(event_ts)                                                                as session_end_ts,
        max(session_number)                                                          as session_number,

        -- first non-null value in the session, ordered by time
        array_agg(event_source   ignore nulls order by event_ts limit 1)[safe_offset(0)] as session_source,
        array_agg(event_medium   ignore nulls order by event_ts limit 1)[safe_offset(0)] as session_medium,
        array_agg(event_campaign ignore nulls order by event_ts limit 1)[safe_offset(0)] as session_campaign,
        array_agg(page_location  ignore nulls order by event_ts limit 1)[safe_offset(0)] as landing_page,

        any_value(first_user_source)                                                 as first_user_source,
        any_value(first_user_medium)                                                 as first_user_medium,
        any_value(device_category)                                                   as device_category,
        any_value(country)                                                           as country,

        countif(event_name = 'page_view')                                            as pageviews,
        sum(coalesce(engagement_time_msec, 0)) / 1000                                as engagement_time_sec,
        logical_or(coalesce(is_session_engaged, false))                              as is_engaged,

        -- funnel steps reached (open funnel: each step counted independently)
        logical_or(event_name = 'view_item')                                         as reached_view_item,
        logical_or(event_name = 'add_to_cart')                                       as reached_add_to_cart,
        logical_or(event_name = 'begin_checkout')                                    as reached_begin_checkout,
        logical_or(event_name = 'add_payment_info')                                  as reached_add_payment_info,
        logical_or(event_name = 'purchase')                                          as reached_purchase,

        count(distinct if(event_name = 'purchase', transaction_id, null))            as transactions,
        sum(if(event_name = 'purchase', coalesce(purchase_revenue_usd, 0), 0))       as revenue_usd

    from events
    group by session_key

)

select
    *,
    -- If the session has no source of its own, fall back to the user's first touch
    coalesce(session_source, first_user_source)                                      as source,
    coalesce(session_medium, first_user_medium)                                      as medium,
    {{ channel_group('coalesce(session_source, first_user_source)',
                     'coalesce(session_medium, first_user_medium)') }}               as channel,
    session_number = 1                                                               as is_new_user_session,
    timestamp_diff(session_end_ts, session_start_ts, second)                         as session_duration_sec
from sessions
