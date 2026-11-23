-- In week 0 every user of the cohort is active by definition, so retention must be 100%.

select *
from {{ ref('fct_weekly_cohorts') }}
where weeks_since_first_visit = 0
  and abs(retention_rate - 1) > 0.0001
