# 12. A full Python pack on Tree-sitter

- Status: Accepted
- Date: 2026-10-19

## Context

Python is the second language with a full map, after JavaScript and TypeScript. Beginners mostly meet it through Flask, FastAPI and Django, with SQLAlchemy or the Django ORM for their database. The basic pack ([ADR 0010](0010-language-packs.md)) already maps Python imports, but shows no routes, databases, services or settings.

Two things don't fit the Next.js shape of the graph. A Flask, FastAPI or Django file can answer many web addresses, while a Next.js route file answers one. And the framework names in `graph.json` only knew Next.js.

## Decision

- Add `packs/python`, listed before the basic pack, so it takes over `.py` files. It reuses the basic pack's Tree-sitter grammar and import rules, so file links stay exactly as before.
- Read the code without running it, like the rest of Grapher. Routes come from decorators (`@app.route`, `@router.get`) and Django's `urlpatterns`. Database use comes from model classes and the calls made on them. Names are followed through imports by matching files, not by Python's own import system.
- Add an optional `routes` list to file nodes (each with a path and its HTTP methods), and `flask`, `fastapi` and `django` to the framework names. Both are additions: older graphs are still valid, so the schema version stays at 1.
- Keep the secret rules: settings by name only, only the scheme of a database address, only the host of an outside web address.

## Consequences

- Python projects get routes, databases, services and settings on the map, and Claude explains them like any other connection.
- Some things only show when the code runs, so Grapher can't see them: a prefix held in a variable (like `prefix=settings.API_V1_STR`), routes added with `add_url_rule`, Django REST framework routers, and models from other packages (like Wagtail pages). Those routes appear without their prefix or not at all. As before, a miss leaves something out; it never invents a connection.
- When a save or delete doesn't name its model on that line (`session.add(user)`), the table is taken from the model the same function creates or mentions. When that isn't clear, the connection is shown without a table name.
- Flask templates (`render_template`) and requests from a JavaScript front end to Python routes are not linked yet.
