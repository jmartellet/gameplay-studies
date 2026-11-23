-- Conversions and revenue per channel under five attribution models.
-- Long format (channel x model) so Looker Studio can use "attribution_model" as a filter.

{% set attribution_models = ['first_touch', 'last_touch', 'last_non_direct', 'linear', 'position_based'] %}

with touchpoints as (

    select
        *,
        max(if(channel != 'Direct', touch_position, null))
            over (partition by conversion_session_key) as last_non_direct_position
    from {{ ref('int_purchase_touchpoints') }}

),

credits as (

    select
        conversion_session_key,
        conversion_revenue_usd,
        channel,
        if(touch_position = 1, 1.0, 0.0)                                              as first_touch_credit,
        if(touch_position = touch_count, 1.0, 0.0)                                    as last_touch_credit,
        -- if every touch was Direct, fall back to the last touch
        if(touch_position = coalesce(last_non_direct_position, touch_count), 1.0, 0.0) as last_non_direct_credit,
        1.0 / touch_count                                                             as linear_credit,
        -- 40% first, 40% last, 20% split across the middle touches
        case
            when touch_count = 1 then 1.0
            when touch_count = 2 then 0.5
            when touch_position in (1, touch_count) then 0.4
            else 0.2 / (touch_count - 2)
        end                                                                           as position_based_credit
    from touchpoints

)

{% for model in attribution_models %}
select
    channel,
    '{{ model }}'                                          as attribution_model,
    sum({{ model }}_credit)                                as attributed_conversions,
    sum({{ model }}_credit * coalesce(conversion_revenue_usd, 0)) as attributed_revenue_usd
from credits
group by channel
{% if not loop.last %}union all{% endif %}
{% endfor %}
