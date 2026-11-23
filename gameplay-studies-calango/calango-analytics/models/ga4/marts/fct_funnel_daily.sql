-- Daily ecommerce funnel by device and channel. Ready for Looker Studio.
-- Conversion rates should be computed in the BI tool as SUM(step)/SUM(sessions),
-- never as the average of pre-computed rates.

select
    session_date,
    device_category,
    channel,
    count(*)                                  as sessions,
    countif(is_engaged)                       as engaged_sessions,
    countif(reached_view_item)                as sessions_view_item,
    countif(reached_add_to_cart)              as sessions_add_to_cart,
    countif(reached_begin_checkout)           as sessions_begin_checkout,
    countif(reached_add_payment_info)         as sessions_add_payment_info,
    countif(reached_purchase)                 as sessions_purchase,
    sum(transactions)                         as transactions,
    sum(revenue_usd)                          as revenue_usd
from {{ ref('fct_sessions') }}
group by session_date, device_category, channel
