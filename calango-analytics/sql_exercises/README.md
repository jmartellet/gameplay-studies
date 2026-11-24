# Exercícios de SQL

Cada arquivo traz **uma pergunta de negócio**, dicas e a **resposta comentada** no final, depois da linha `RESPOSTA`. Tente resolver antes de rolar até lá.

Rode tudo no console do BigQuery (no navegador, modo sandbox gratuito).

| # | Arquivo | Conceito praticado |
|---|---------|--------------------|
| G1 | `ga4/01_explorar_eventos.sql` | `UNNEST`, contar chaves de `event_params` |
| G2 | `ga4/02_paginas_mais_vistas.sql` | subquery escalar em `event_params` |
| G3 | `ga4/03_caminho_de_navegacao.sql` | `ROW_NUMBER`, `LAG`, `LEAD`, `FIRST_VALUE` |
| G4 | `ga4/04_funil_ordenado.sql` | funil fechado com timestamps, `COUNTIF` |
| G5 | `ga4/05_receita_media_movel.sql` | moldura de janela `ROWS BETWEEN` |
| G6 | `ga4/06_top_produtos_por_categoria.sql` | `QUALIFY`, `RANK` |
| G7 | `ga4/07_custo_da_query.sql` | particionamento, `_TABLE_SUFFIX`, custo |
| Y1 | `youtube/01_parse_de_texto.sql` | `REGEXP_EXTRACT`, `SPLIT`, `SAFE_CAST` |
| Y2 | `youtube/02_maior_sequencia.sql` | *gaps and islands* (`LAG` + soma acumulada) |
| Y3 | `youtube/03_melhor_episodio_por_serie.sql` | `QUALIFY ROW_NUMBER()`, `PERCENT_RANK` |
| Y4 | `youtube/04_antes_e_depois_de_2025.sql` | agregação condicional (`COUNTIF`, `APPROX_QUANTILES(IF())`), `SAFE_DIVIDE` |
