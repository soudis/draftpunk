# Content stays separate from the design

Pages and events are content documents. The design (shell, layouts, stylesheet, brief) is shared, and a design-mode change restyles every page, including imported ones. Page markup may include structural HTML only; class, style, and script are stripped. Tailwind scans the design files alone, so a class in a page never becomes CSS.
