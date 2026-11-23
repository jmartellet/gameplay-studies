{#
    Simplified version of GA4's default channel grouping, based on source and medium.
    The sample dataset is obfuscated: some values come as '<Other>' or '(data deleted)',
    so they get their own group instead of polluting "Unassigned".
#}
{% macro channel_group(source, medium) %}
    case
        when {{ source }} in ('<Other>', '(data deleted)')
          or {{ medium }} in ('<Other>', '(data deleted)')
            then 'Obfuscated'
        when {{ source }} = '(direct)'
         and ({{ medium }} in ('(none)', '(not set)') or {{ medium }} is null)
            then 'Direct'
        when regexp_contains(lower({{ medium }}), r'^(cpc|ppc|paidsearch)$')
            then 'Paid Search'
        when regexp_contains(lower({{ medium }}), r'^(display|banner|cpm)$')
            then 'Display'
        when lower({{ medium }}) = 'organic'
            then 'Organic Search'
        when regexp_contains(lower({{ medium }}), r'^(social|social-network|social-media|sm)$')
          or regexp_contains(lower({{ source }}), r'facebook|instagram|linkedin|twitter|t\.co|youtube|tiktok|pinterest|reddit')
            then 'Organic Social'
        when regexp_contains(lower({{ medium }}), r'^(email|e-mail|e_mail)$')
            then 'Email'
        when lower({{ medium }}) = 'affiliate'
            then 'Affiliates'
        when lower({{ medium }}) = 'referral'
            then 'Referral'
        else 'Unassigned'
    end
{% endmacro %}
