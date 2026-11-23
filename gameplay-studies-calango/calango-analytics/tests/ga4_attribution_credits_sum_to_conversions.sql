-- Every attribution model must hand out exactly one conversion per converting session.
-- Returns rows (= test fails) when a model's total credit differs from the number of conversions.

with by_model as (

    select attribution_model, sum(attributed_conversions) as total_credit
    from {{ ref('fct_channel_attribution') }}
    group by attribution_model

),

expected as (

    select count(distinct conversion_session_key) as conversions
    from {{ ref('int_purchase_touchpoints') }}

)

select *
from by_model
cross join expected
where abs(total_credit - conversions) > 0.001
