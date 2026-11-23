-- One row per item inside an ecommerce event (view_item, add_to_cart, begin_checkout, purchase).

select
    e.event_date,
    e.event_ts,
    e.event_name,
    e.user_pseudo_id,
    e.session_key,
    e.transaction_id,
    i.item_id,
    i.item_name,
    i.item_category,
    i.price_in_usd,
    i.quantity,
    i.item_revenue_in_usd
from {{ ref('stg_ga4__events') }} as e,
    unnest(e.items) as i
where e.event_name in ('view_item', 'add_to_cart', 'begin_checkout', 'purchase')
