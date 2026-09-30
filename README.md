# Excel Easy

A friendly helper that explains Microsoft Excel in plain English, built for complete beginners.
No install, no account, no build step: open `index.html` in any browser.

## What's inside

| Section | What it does |
| --- | --- |
| **Start here** | Type what you want in your own words ("add up a column", "make a chart") and get step-by-step instructions plus a ready-made formula. |
| **Lessons** | 11 short lessons (3–4 min each) from "meet the screen" to IF, charts and saving. Progress is remembered on your device. |
| **Formula builder** | Pick a task, fill in labelled boxes, get a formula with a plain-English explanation and a Copy button. |
| **Practice sheet** | A safe mini-spreadsheet with a real formula engine, undo, mini challenges, and friendly explanations of every cell and error. |
| **Fix a problem** | A formula checker (missing `=`, unbalanced brackets, semicolons, curly quotes, typos) and an error decoder (`#REF!`, `####`, …). |
| **Words & shortcuts** | Searchable glossary and the keyboard shortcuts that matter. |

Accessibility: keyboard friendly, screen-reader labels, adjustable text size (A+ / A−), light/dark mode, works on phones.

## Files

- `index.html`, `styles.css` – the page
- `app.js` – UI behaviour
- `data.js` – all lessons, tasks, errors and glossary text (edit this to change content)
- `engine.js` – dependency-free formula parser/evaluator (SUM, AVERAGE, IF, SUMIF, COUNTIF, VLOOKUP, IFERROR, text functions and more)
- `test/engine.test.js` – engine tests

## Run the tests

```
node test/engine.test.js
```

Excel is a trademark of Microsoft. This is an independent learning aid.
