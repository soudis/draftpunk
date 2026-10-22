# Site builder

The editor that sets up and changes a housing project's website, and the public site that project publishes.

## Language

**Site instance**:
One project's website, with its own content, design, group, and git history.
_Avoid_: tenant, site

**Site name**:
The name of one site instance. The editor shows it, and the public site uses it.
_Avoid_: project name, title

**Editor**:
The authenticated chat for one site instance. Each person has their own chats. A reply may change the design and the content that fills it.
_Avoid_: chatbot, agent, Design mode, content mode

**Draft**:
The unpublished revision of the whole site instance. The private preview is this revision.
_Avoid_: branch, staging

**Public site**:
The published revision visitors open.
_Avoid_: production build, live site

**Publish**:
Making the draft the public site. The editor lists what would change, in sentences, and writes only after that list is confirmed.
_Avoid_: deploy, merge

**Undo**:
Dropping the files written by the last reply that changed the draft, when no later change has edited those same files. The chat text stays. The public site stays until the next publish.
_Avoid_: revert draft, reset

**Revert draft**:
Putting the draft back to the public site, after asking, and discarding every unpublished change. The draft is shared, so this includes other people's unpublished changes.
_Avoid_: undo, unpublish

**Content**:
What a page or event says, in each language the site instance uses, with no layout of its own. For a page, this is its title and its slot values. For an event, this includes which option it picks for a field.
_Avoid_: copy, body HTML

**Language**:
A language a site instance authors. The first one is the default and has no address prefix. A language may be optional, so a missing text does not block publish.
_Avoid_: locale, translation

**Setup**:
The conversation that decides a new site instance's languages, layouts, labels, tokens, look, and initial content. On a fresh instance it starts by itself, with a few scripted questions that can be skipped, including whether a source site exists and what to take from it, and it ends when its proposal is accepted.
_Avoid_: install, onboarding, wizard

**Tag**:
A short word on a picture, for filtering pictures in the media manager. You can type a new one. The public site does not show it.
_Avoid_: category, label

**Description**:
German text kept with a picture so you can find it in the media manager. The public site does not show it.
_Avoid_: caption, alt text

**Picture**:
A file the site shows: JPEG, PNG, WebP, GIF, or SVG. It is kept with the site's other pictures, and a page refers to it. The content chat can save one you name from a public website. It looks, fills the German description and the tags, chooses a short readable name, and tells you the address. You can change or discard that picture afterwards in the media manager, and the content chat can discard one you name. A picture you paste or upload is stored immediately. A modal then edits its name, tags, and description, or discards it and removes the file. Discarding removes the file even while content still uses it, and it does not change pages. The modal shows how often the content refers to that picture. A paste with no filename starts as picture. Confirming the modal puts its address into the message you are writing. An uploaded file starts from its original filename. You can ask the chat to fill those fields by looking at the stored picture, and you can change what it filled in. The chat keeps an existing file when that name is taken, and replaces a picture only when asked. Later replies in that chat remember the address. It puts a picture on a page only when asked. When it does, the page uses a WebP made for twice the width that place gives the picture, and the original file stays. A GIF or an SVG stays as stored. A WebP already made for that original and width is used again.
_Avoid_: asset, upload, media file

**Media manager**:
A view in the editor that lists the site's pictures. You can upload a picture there, or open one in the same modal to change its name, tags, and description, or discard it. Selecting pictures inserts their addresses into the message you are writing.
_Avoid_: library, gallery, asset manager

**Layout**:
A page shape the design owns: a folder with a purpose line, a typed slot schema, a template, and styles that apply to that layout only. A layout may serve one page or many, and a site may have any number of them. It holds no words of its own, no picture address, and no rule that names a page. The generated layouts (event, calendar, archive) take their data from the generator instead of slots.
_Avoid_: template, theme, section list

**Slot**:
A named, typed value a layout shows. Its type is text, markdown, image, link, date, a list of one type, or a group of named slots. Text and markdown hold one entry per language; the others are stored once. A page's content has the shape of its layout's slots.
_Avoid_: field, section, content structure

**Label**:
A short interface word that belongs to the design, such as a menu entry or "Read more", kept in each language in one file and shown by templates. It is not page content.
_Avoid_: string, translation, copy

**Design token**:
A named color, font, corner radius, or content width of the site, kept in one file. Layouts and styles use a token by its name, so changing the token changes every place that uses it.
_Avoid_: variable, theme value, style guide

**Rule**:
A lasting preference of the person about how the site looks, kept as one short line and followed in every later chat.
_Avoid_: setting, instruction, memory

**Tips**:
A short card in an empty chat that says what can be asked, how to change a sentence by clicking it, and that Undo and Publish exist, with a few example requests. It is fixed text in the editor's language, and it goes away with the first message.
_Avoid_: help, tutorial, tour

**Baseline**:
What every site gets without being asked for: pictures that load lazily and keep their space, fonts served from the site itself, a soft page transition, a sitemap, robots and not-found page, page descriptions, a skip link, and visible keyboard focus. The generator does the mechanical part and the starter design holds the visual part.
_Avoid_: boilerplate, defaults, preset

**Reference**:
A site the person likes, kept with how it looks (colors by role, type, shape, the sections in order) and what they like about it, so later chats can match it. It describes a look and holds no content of the site.
_Avoid_: inspiration, template, import

**Source site**:
A public website of the person, or one they may use, from which setup takes texts and pictures, and optionally the look. Setup asks for it by itself. The person says what to take: the look, texts, pictures, and whether that is the main pages or every page and post. Unlike a reference, a source site gives content to the new site instance.
_Avoid_: import, migration, old site, copy

**Catalog**:
What the agent sees of the site's layouts: each one's name, purpose, slot signature, and the pages that use it. It is built from the layout folders and is how a layout is found and reused.
_Avoid_: registry, library

**Design**:
The shell, stylesheet, design tokens, layouts, labels, navigation, rules, design brief, and fields of one site instance. The shell and navigation hold no page content and do not name one page.
_Avoid_: theme, skin, data model

**Design brief**:
The current shared look of one site: colors, type, spacing, and mood. Every chat starts from it. It is not a log of edits, it does not hold one page's sentences, and it does not describe individual layouts, which carry their own purpose.
_Avoid_: memory, transcript, theme

**Page**:
A title in each language, a layout, and the values of that layout's slots. The home page is the front page. It can be rewritten, and it cannot be removed. One file holds all languages of a page.
_Avoid_: post, article, document

**Room**:
A layout in the housing kit for a space on the premises, with pictures, prose, and an email.
_Avoid_: Place, venue

**News item**:
A dated page that can appear in the archive and on the homepage.
_Avoid_: blog post, article

**Field**:
A property of an event that may be left empty. An event may have several. The design owns each field's closed list of options. Content picks one option per field, and a layout shows a field, only when asked. Removing a field leaves existing events unchanged, and new events do not gain it.
_Avoid_: data model, schema, column

**Option**:
One choice in a field's closed list: an id and a label in each language. An event stores the id. A stored id that is no longer an option is ignored.
_Avoid_: enum, value

**Event**:
A series of dates at a place.
_Avoid_: appointment, calendar entry

**Place**:
Where an event happens. It may be on the premises or elsewhere.
_Avoid_: location, venue, room
