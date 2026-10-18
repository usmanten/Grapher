# Architecture decision records

Each file here records one significant decision: the context, what was decided, and the consequences. They are numbered in order and never deleted. A decision that changes later gets a new record that supersedes the old one.

| #    | Decision                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| 0001 | [Record architecture decisions](0001-record-architecture-decisions.md)                                       |
| 0002 | [Parse code for connections, use an LLM only to explain](0002-parse-for-connections-llm-for-explanations.md) |
| 0003 | [The CLI makes no network requests](0003-no-network-in-cli.md)                                               |
| 0004 | [Secret files are denylisted and all reads go through one gate](0004-secret-denylist-and-read-gate.md)       |
| 0005 | [Stay on TypeScript 6 for now](0005-typescript-6.md)                                                         |
| 0006 | [Parse code in memory, from approved files only](0006-in-memory-parsing.md)                                  |
| 0007 | [Ship the viewer as one self-contained HTML file](0007-single-file-viewer.md)                                |
