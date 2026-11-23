-- One row per GA4 event, with the event_params we use flattened into columns.
-- The only model that reads the raw export: everything downstream uses ref().

with source as (

    select *
    from {{ source('ga4', 'events') }}
    where _table_suffix between '{{ var("start_date") }}' and '{{ var("end_date") }}'

),

flattened as (

    select
        parse_date('%Y%m%d', event_date)                                                   as event_date,
        timestamp_micros(event_timestamp)                                                  as event_ts,
        event_name,
        user_pseudo_id,

        -- session identifiers
        (select value.int_value from unnest(event_params) where key = 'ga_session_id')     as ga_session_id,
        (select value.int_value from unnest(event_params) where key = 'ga_session_number') as session_number,

        -- page
        (select value.string_value from unnest(event_params) where key = 'page_location')  as page_location,
        (select value.string_value from unnest(event_params) where key = 'page_title')     as page_title,

        -- session-scoped traffic source (sent on session_start / page_view)
        (select value.string_value from unnest(event_params) where key = 'source')         as event_source,
        (select value.string_value from unnest(event_params) where key = 'medium')         as event_medium,
        (select value.string_value from unnest(event_params) where key = 'campaign')       as event_campaign,

        -- engagement
        (select value.int_value from unnest(event_params) where key = 'engagement_time_msec') as engagement_time_msec,
        (
            select coalesce(value.string_value, cast(value.int_value as string))
            from unnest(event_params)
            where key = 'session_engaged'
        ) = '1'                                                                            as is_session_engaged,

        -- user-scoped (first touch) traffic source
        traffic_source.source                                                              as first_user_source,
        traffic_source.medium                                                              as first_user_medium,
        traffic_source.name                                                                as first_user_campaign,

        device.category                                                                    as device_category,
        geo.country                                                                        as country,

        -- ecommerce
        nullif(ecommerce.transaction_id, '(not set)')                                      as transaction_id,
        ecommerce.purchase_revenue_in_usd                                                  as purchase_revenue_usd,
        items

    from source

)

select
    *,
    concat(user_pseudo_id, '-', cast(ga_session_id as string)) as session_key
from flattened
