# The model token stays outside the site

The editor's model address, token, and model name are saved beside the chat database, not in the site instance. The environment is only a fallback. A token in the site files would be committed with the draft and could be published, and the process environment cannot change while the editor is running.
