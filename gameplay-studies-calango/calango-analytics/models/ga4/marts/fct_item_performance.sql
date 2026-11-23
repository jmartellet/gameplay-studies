-- Product performance: views, add-to-carts, purchases and revenue per item.

with items as (

    select *
    from {{ ref('stg_ga4__items') }}
    where item_id is not null and item_id != '(not set)'

),

aggregated as (

    select
        item_id,
        any_value(item_name)                                                as item_name,
        any_value(item_category)                                            as item_category,
        countif(event_name = 'view_item')                                   as item_views,
        countif(event_name = 'add_to_cart')                                 as add_to_carts,
        countif(event_name = 'purchase')                                    as purchase_lines,
        sum(if(event_name = 'purchase', coalesce(quantity, 0), 0))          as units_sold,
        sum(if(event_name = 'purchase', coalesce(item_revenue_in_usd, 0), 0)) as item_revenue_usd
    from items
    group by item_id

)

select
    *,
    safe_divide(add_to_carts, item_views)   as view_to_cart_rate,
    safe_divide(purchase_lines, item_views) as view_to_purchase_rate,
    rank() over (order by item_revenue_usd desc) as revenue_rank
from aggregated
