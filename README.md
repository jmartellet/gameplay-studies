# 🎮 gameplay-studies

Estudos e projetos práticos sobre o universo **gamer + livestream**: as dores reais de streamers e comunidades, transformadas em ferramentas.

Cada pasta é um projeto independente, com o próprio README, dependências e testes.

## Projetos

| Projeto | Dor que resolve | Stack | Status |
|---|---|---|---|
| [**pedirjogo**](./pedirjogo) | Pedidos de jogos espalhados entre chat e Discord, sem ordem e sem contexto da Steam | Node.js · TypeScript · SQLite · Twitch/Discord bots | [![pedirjogo](https://github.com/jmartellet/gameplay-studies/actions/workflows/pedirjogo.yml/badge.svg)](https://github.com/jmartellet/gameplay-studies/actions/workflows/pedirjogo.yml) |

### pedirjogo

Fila de pedidos de jogos para streamers. Os inscritos buscam o jogo direto na Steam e votam (1 voto por conta); o streamer vê o que o público quer **e** como o jogo está na Steam: avaliações, jogadores agora e posição no top 100. Funciona pelo site, pelo chat da Twitch (`!pedirjogo`) e pelo Discord (`/pedirjogo`), com overlay para o OBS.

→ [Ver o projeto](./pedirjogo)

## Estrutura

```
gameplay-studies/
├── .github/workflows/   um workflow de CI por projeto
├── pedirjogo/           projeto 1
└── <próximo-projeto>/   projeto 2...
```

## Licença

[MIT](./LICENSE)
