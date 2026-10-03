# A layout is an ordered list of shared section shapes

A kit layout declares sections. Each section has one shape from a closed set the generator renders: title, prose, hero, cards, band, pictures, email, picture groups, link groups, news, and upcoming. A new shape is a change to this software, shared by every site instance. An existing Nunjucks layout is still rendered as that template, so a site instance that already has one keeps its pages. Free per-page templates were rejected because setup could not know what content a layout is supposed to hold.
