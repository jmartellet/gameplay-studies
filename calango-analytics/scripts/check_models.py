"""Checagem local/CI dos modelos dbt, sem BigQuery.

- Módulo YouTube: renderiza o Jinja, traduz BigQuery -> DuckDB (sqlglot) e EXECUTA
  todos os modelos e o teste de datas sobre os seeds.
- Módulo GA4: o dataset é público mas fica no BigQuery, então aqui só checa a sintaxe.

Uso: python scripts/check_models.py [pasta_de_saida_csv]
"""
import glob, re, sys
from pathlib import Path

import duckdb, jinja2, pandas as pd, sqlglot, yaml

ROOT = Path(__file__).resolve().parent.parent
VARS = yaml.safe_load((ROOT / 'dbt_project.yml').read_text())['vars']
ENV = jinja2.Environment()
CTX = {'ref': lambda n: n, 'var': lambda n: VARS[n], 'source': lambda a, b: f'{a}_{b}'}
failures = 0


def to_duckdb(sql: str) -> str:
    tree = sqlglot.parse_one(sql, read='bigquery')
    # No BigQuery, REGEXP_EXTRACT devolve o grupo 1 quando o padrão tem um grupo de captura.
    for node in tree.find_all(sqlglot.exp.RegexpExtract):
        pat = node.expression
        if isinstance(pat.this, str) and re.search(r'\((?!\?)', pat.this):
            node.set('group', sqlglot.exp.Literal.number(1))
    return tree.sql(dialect='duckdb')


def render(path: Path, prefix: str = '') -> str:
    return ENV.from_string(prefix + path.read_text()).render(**CTX)


# ---------- YouTube: execução completa ----------
con = duckdb.connect()
for seed in ['calango_videos_raw', 'calango_game_aliases']:
    df = pd.read_csv(ROOT / 'seeds' / f'{seed}.csv', dtype=str)
    for col in ['channel_position', 'priority']:
        if col in df:
            df[col] = df[col].astype(int)
    con.register(f'{seed}_df', df)
    con.execute(f'create table {seed} as select * from {seed}_df')

order = ['staging/stg_calango__videos', 'intermediate/int_calango__videos_dated',
         'marts/fct_calango_videos', 'marts/fct_calango_games', 'marts/fct_calango_series_decay',
         'marts/fct_calango_decay_curve', 'marts/fct_calango_quarterly']
for model in order:
    path = ROOT / 'models' / 'youtube' / f'{model}.sql'
    con.execute(f'create table {path.stem} as {to_duckdb(render(path))}')
    print(f'ok   {path.stem}: {con.execute(f"select count(*) from {path.stem}").fetchone()[0]} linhas')

# testes genéricos principais
for table, col in [('stg_calango__videos', 'video_id'), ('fct_calango_videos', 'video_id'), ('fct_calango_games', 'game')]:
    dup, nulls = con.execute(f'select count(*) - count(distinct {col}), countif({col} is null) from {table}').fetchone()
    if dup or nulls:
        failures += 1
        print(f'FAIL {table}.{col}: {dup} duplicados, {nulls} nulos')

# teste singular
bad = con.execute(to_duckdb(render(ROOT / 'tests' / 'youtube_dates_inside_bounds.sql'))).df()
if len(bad):
    failures += 1
    print(f'FAIL youtube_dates_inside_bounds: {len(bad)} linhas\n{bad.head()}')
else:
    print('ok   youtube_dates_inside_bounds')

if len(sys.argv) > 1:
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    for model in order[2:]:
        name = Path(model).name
        con.execute(f'select * from {name}').df().to_csv(out / f'{name}.csv', index=False)

# ---------- GA4: sintaxe ----------
macros = ''.join(Path(m).read_text() for m in glob.glob(str(ROOT / 'macros' / '*.sql')))
for f in sorted(glob.glob(str(ROOT / 'models' / 'ga4' / '**' / '*.sql'), recursive=True)
                + glob.glob(str(ROOT / 'tests' / 'ga4_*.sql'))):
    try:
        sqlglot.parse_one(render(Path(f), macros), read='bigquery')
        print(f'ok   sintaxe {Path(f).name}')
    except Exception as e:
        failures += 1
        print(f'FAIL sintaxe {Path(f).name}: {str(e)[:300]}')

print(f'\n{failures} falha(s)')
sys.exit(1 if failures else 0)
