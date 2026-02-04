# Multi-Agent Protocol Documentation Site

This directory contains the Jekyll-based documentation site for the Multi-Agent Protocol.

## Local Development

### Prerequisites

- Ruby 3.0+
- Bundler

### Setup

```bash
cd docs-site
bundle install
```

### Running Locally

```bash
bundle exec jekyll serve
```

The site will be available at http://localhost:4000/multi-agent-protocol/

### Live Reload

For automatic reloading during development:

```bash
bundle exec jekyll serve --livereload
```

## Structure

```
docs-site/
├── _config.yml              # Jekyll configuration
├── Gemfile                  # Ruby dependencies
├── index.md                 # Homepage
├── getting-started/         # Getting started guides
├── protocol/                # Protocol specification
├── sdk/                     # SDK documentation
│   ├── guides/              # Integration guides
│   └── api/                 # API reference
└── examples/                # Working examples
```

## Adding New Pages

1. Create a markdown file in the appropriate directory
2. Add front matter:

```yaml
---
title: Page Title
parent: Parent Section
nav_order: 1
description: "Brief description"
---
```

3. Write content using GitHub-flavored Markdown

## Search

Search is powered by [Lunr.js](https://lunrjs.com/) and is automatically enabled, indexing all pages.

## Deployment

The site automatically deploys to GitHub Pages when changes are pushed to the `main` branch. See `.github/workflows/docs.yml` for the deployment configuration.

## Customization

- Colors and branding: Edit `_config.yml`
- Custom CSS: Create `_sass/custom/custom.scss`
- Custom layouts: Create files in `_layouts/`

## Links

- [Jekyll documentation](https://jekyllrb.com/docs/)
