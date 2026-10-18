# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scanner that lists the files Grapher may analyze and reports what it skips and why.
- Secret-file protection: `.env` files, keys, certificates and credential files are never opened.
- `.gitignore` support, including nested files and negation rules.
- A single safe reader for file contents that refuses secret files, symlinks, paths outside the project and oversized files.
- `grapher scan [folder]` command with a readable summary and `--json` output.
- CI with linting, type checks, tests with coverage, CodeQL, dependency review, a dependency audit and secret scanning.
