-- One row per video, with the scraped text fields turned into numbers.
-- Raw input: "2:15:22" | "12 thousand views" | "2 years ago"

with raw as (

    select * from {{ ref('calango_videos_raw') }}

),

parsed as (

    select
        channel_position,          -- 0 = newest video on the channel page
        video_id,
        trim(title)                                                             as title,

        -- "H:MM:SS" or "MM:SS" -> seconds
        case
            when array_length(split(duration, ':')) = 3 then
                  cast(split(duration, ':')[offset(0)] as int64) * 3600
                + cast(split(duration, ':')[offset(1)] as int64) * 60
                + cast(split(duration, ':')[offset(2)] as int64)
            else
                  cast(split(duration, ':')[offset(0)] as int64) * 60
                + cast(split(duration, ':')[offset(1)] as int64)
        end                                                                     as duration_sec,

        -- "3.9 thousand views" -> 3900. YouTube rounds, so this is approximate.
        cast(round(
            safe_cast(regexp_extract(views_text, r'^([\d.]+)') as float64)
            * case
                when views_text like '%million%'  then 1000000
                when views_text like '%thousand%' then 1000
                else 1
              end
        ) as int64)                                                             as views,

        safe_cast(regexp_extract(age_text, r'(\d+)') as int64)                  as age_amount,
        regexp_extract(age_text, r'\d+ (day|week|month|year)')                  as age_unit,
        age_text,
        views_text
    from raw

)

select * from parsed
