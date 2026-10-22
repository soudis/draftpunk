# Design tokens and rules keep the look consistent, and break nothing

Colors, fonts, corner radii, and content widths are named tokens in `design/tokens.yml`, and the generator builds them into the Tailwind theme, so a layout says `bg-primary` or `var(--color-primary)` instead of a value. A lasting preference of the person is a one-line rule in `design/rules.md`. Both are in the agent's prompt on every request.

A file that uses a raw color, a font that is not a token, a default palette color, or an inline style is written anyway, and the tool names the token to use. Refusing was rejected: the agent is meant to be free in how it builds a page, and a refused write that it works around costs more than a hint it may ignore. What is refused stays what keeps content and design apart (ADR 0013). Token pairs that read badly together (a text color on its fill) are reported when the tokens change.
