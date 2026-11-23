# Roteiro do dashboard (Looker Studio)

Crie em **lookerstudio.google.com** → Relatório em branco → conector **BigQuery** → seu projeto → dataset do dbt (ex.: `dbt_juliana`). Adicione cada tabela abaixo como uma fonte de dados.

**Regra de ouro para taxas:** crie sempre como campo calculado `SUM(numerador) / SUM(denominador)`. Nunca use a média de uma taxa já calculada, porque ela dá peso igual a dias ou grupos de tamanhos diferentes.

---

## Página 1: Canal CalangoLive

**Fonte:** `fct_calango_videos`, `fct_calango_games`, `fct_calango_decay_curve`, `fct_calango_quarterly`

| Elemento | Configuração |
|---|---|
| 4 scorecards | Vídeos (`COUNT(video_id)`), Views (`SUM(views)`), Horas (`SUM(duration_sec)/3600`), Mediana de views (`MEDIAN(views)`) |
| Linha | `fct_calango_quarterly`: dimensão `published_quarter`; métricas `median_views` e `videos` (eixo duplo) |
| Linha | `fct_calango_decay_curve`: dimensão `episode_number`; métrica `median_retention_vs_episode_1` (formato %). Título: "Quanto da audiência do ep. 1 sobra em cada episódio" |
| Dispersão | `fct_calango_games` filtrado `videos >= 5`: X = `videos`, Y = `median_views`, bolha = `total_views`, dimensão `game`. Use escala log nos dois eixos |
| Tabela | `fct_calango_games`: `game`, `genre`, `videos`, `median_views`, `share_of_channel_views`, ordenada por `total_views` |
| Barras | `fct_calango_videos`: dimensão `genre`, métrica `MEDIAN(views)` |
| Controles | Filtros de `published_year`, `content_type`, `genre` |

## Página 2: GA4, visão geral e funil

**Fonte:** `fct_funnel_daily`

Campos calculados:
- `Taxa de conversão` = `SUM(sessions_purchase) / SUM(sessions)`
- `Ticket médio` = `SUM(revenue_usd) / SUM(transactions)`
- `View → Carrinho` = `SUM(sessions_add_to_cart) / SUM(sessions_view_item)`
- `Carrinho → Checkout` = `SUM(sessions_begin_checkout) / SUM(sessions_add_to_cart)`
- `Checkout → Compra` = `SUM(sessions_purchase) / SUM(sessions_begin_checkout)`

| Elemento | Configuração |
|---|---|
| Scorecards | Sessões, Taxa de conversão, Receita, Ticket médio (com comparação ao período anterior) |
| Série temporal | `session_date` × sessões e receita |
| Barras (funil) | Uma barra por etapa: sessions, sessions_view_item, sessions_add_to_cart, sessions_begin_checkout, sessions_purchase |
| Tabela | `channel` × sessões, taxa de conversão, receita |
| Controles | `device_category`, `channel`, período |

## Página 3: GA4, atribuição e retenção

**Fontes:** `fct_channel_attribution`, `fct_weekly_cohorts`, `fct_item_performance`

| Elemento | Configuração |
|---|---|
| Barras agrupadas | `fct_channel_attribution`: dimensão `channel`, detalhamento `attribution_model`, métrica `attributed_revenue_usd` |
| Controle | lista suspensa de `attribution_model` |
| Tabela dinâmica (heatmap) | `fct_weekly_cohorts`: linhas `cohort_week`, colunas `weeks_since_first_visit`, métrica `retention_rate` com mapa de calor |
| Tabela | `fct_item_performance`: top 20 por `item_revenue_usd`, com `view_to_cart_rate` |

---

**Texto de cada página:** coloque uma caixa de texto com 1 a 2 frases dizendo **o que o gráfico mostra e o que fazer com isso**. É o que diferencia um dashboard de portfólio de uma coleção de gráficos.
