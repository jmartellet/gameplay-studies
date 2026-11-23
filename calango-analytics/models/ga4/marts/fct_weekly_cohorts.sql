-- Weekly retention: users grouped by the week of their first-ever session
-- (session_number = 1), and how many came back in each following week.

with user_weeks as (

    select distinct
        user_pseudo_id,
        date_trunc(session_date, week(monday)) as activity_week
    from {{ ref('fct_sessions') }}

),

cohorts as (

    -- only users whose first session happened inside the dataset window
    select
        user_pseudo_id,
        min(date_trunc(session_date, week(monday))) as cohort_week
    from {{ ref('fct_sessions') }}
    where is_new_user_session
    group by user_pseudo_id

),

cohort_sizes as (

    select cohort_week, count(*) as cohort_users
    from cohorts
    group by cohort_week

),

activity as (

    select
        c.cohort_week,
        date_diff(w.activity_week, c.cohort_week, week(monday)) as weeks_since_first_visit,
        w.user_pseudo_id
    from cohorts as c
    inner join user_weeks as w
        on  w.user_pseudo_id = c.user_pseudo_id
        and w.activity_week >= c.cohort_week

)

select
    a.cohort_week,
    a.weeks_since_first_visit,
    s.cohort_users,
    count(distinct a.user_pseudo_id)                              as active_users,
    safe_divide(count(distinct a.user_pseudo_id), s.cohort_users) as retention_rate
from activity as a
inner join cohort_sizes as s using (cohort_week)
group by a.cohort_week, a.weeks_since_first_visit, s.cohort_users
