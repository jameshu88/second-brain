# Dashboard

Enable **Obsidian → Settings → Community plugins → Dataview** for the queries below.

## Inbox (uncaptured triage)

```dataview
TABLE created, source, type, file.folder AS folder
FROM "00_Inbox"
WHERE status = "inbox"
SORT created DESC
LIMIT 25
```

## Active projects

```dataview
TABLE status, file.mtime AS updated
FROM "01_Projects"
WHERE contains(file.name, ".md") AND !contains(file.name, "Templates")
SORT file.mtime DESC
LIMIT 15
```

## Areas

```dataview
LIST
FROM "02_Areas"
WHERE contains(file.name, ".md")
SORT file.name ASC
```

## Open tasks (Obsidian Tasks plugin syntax)

```dataview
TASK
FROM ""
WHERE !completed
SORT due ASC
LIMIT 25
```

## Recently touched

```dataview
TABLE file.mtime AS modified
FROM ""
WHERE file.path != "_Dashboard.md"
SORT file.mtime DESC
LIMIT 20
```
