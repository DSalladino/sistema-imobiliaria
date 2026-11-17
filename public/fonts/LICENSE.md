# Fontes

Os arquivos `.woff2` desta pasta são servidos pelo próprio sistema (sem CDN de
terceiros), o que mantém o funcionamento offline e evita enviar o IP do usuário
para o Google.

| Família | Uso | Licença |
|---|---|---|
| DM Sans | texto e interface | SIL Open Font License 1.1 |
| Fraunces | títulos | SIL Open Font License 1.1 |

Arquivos obtidos do Google Fonts (subsets `latin` e `latin-ext`) e regravados em
`fontes.css` sem o subset `vietnamese`, que o sistema não utiliza.

- DM Sans — https://fonts.google.com/specimen/DM+Sans
- Fraunces — https://fonts.google.com/specimen/Fraunces
- Licença OFL — https://openfontlicense.org/

Ao atualizar as fontes, repita o processo: baixe o CSS do Google com um
`User-Agent` de navegador moderno, mantenha um arquivo por família/subset e
declare a faixa de pesos (`font-weight: 400 700`).
