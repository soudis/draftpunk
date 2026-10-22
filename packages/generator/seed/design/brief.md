# Design brief

Pages are content. The shell, the layouts, and the stylesheets decide how every page looks.

Use calm, neutral colors. Type is Source Sans for text and Source Serif for headings. Corners stay square. The header carries the project name and the main sections. The footer carries the legal links and the year.

Each page picks one layout. Each layout is a folder with the slots it shows, its markup, and its own styles. The page's content has the shape of those slots. The calendar, the event page, and the archive are generated. Do not invent a second calendar in a page.

Content may use headings, lists, links, images, figures, and tables. It may not carry its own colors, classes, or scripts. When the design changes, every existing page, including old news, has to follow.

The site's languages are listed in site.yml. The first language is the default. Write every language that is not optional. An optional language may be left empty.
