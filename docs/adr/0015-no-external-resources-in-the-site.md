# A design file that loads anything from another host is refused

A template, the shell, or a stylesheet may not load a stylesheet, script, font, picture, video, or frame from another host, including `@import url(https://…)`. A plain outbound link (`<a href>`) is allowed. The refusal says to keep the file on the site instead: `save_picture` for a picture, `add_font` for a font. A visitor's browser then contacts only the site itself, so no address of a visitor reaches a third party, which is what the GDPR (DSGVO) cases about hosted fonts were about.

This is a refusal and not advice like the design tokens (ADR 0014), because it is a legal matter and not a matter of taste, and an agent that works around a hint would put the site in breach. The cost is that maps, video embeds, and analytics are impossible until a click-to-load embed exists. The starter design used to load its fonts from Google, and no longer does.
