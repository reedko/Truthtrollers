# Open Source Dependencies

This file lists the direct third-party open source dependencies used by the main code areas in this repository.

It is grouped by package so it is easy to scan and update.

## Shared

- `axios`
- `cheerio`
- `cors`
- `express`

## Backend

### API and server

- `express`
- `cors`
- `body-parser`
- `cookie-parser`
- `dotenv`
- `jsonwebtoken`
- `axios`

### Data and storage

- `mysql`
- `mysql2`
- `redis`
- `fs-extra`
- `csv-parser`

### Scraping and parsing

- `cheerio`
- `jsdom`
- `puppeteer`
- `@mozilla/readability`
- `jsonrepair`

### Media and documents

- `sharp`
- `pdf-lib`
- `pdf-parse`
- `pdf-poppler`
- `pdf2pic`
- `multer`

### LLM, push, and utilities

- `openai`
- `tiktoken`
- `nodemailer`
- `web-push`
- `uuid`
- `opentimestamp`

### Graph, editor, and UI-related server helpers

- `cytoscape`
- `d3`
- `reactflow`
- `react-flow-renderer`
- `slate`
- `slate-react`
- `slate-history`

## Dashboard

### UI framework

- `react`
- `react-dom`
- `@chakra-ui/react`
- `@chakra-ui/icons`
- `@chakra-ui/system`
- `@chakra-ui/theme-tools`

### Animation and layout

- `framer-motion`
- `react-draggable`

### Graph and layout engines

- `cytoscape`
- `cytoscape-dagre`
- `cytoscape-qtip`
- `reactflow`
- `react-force-graph-2d`
- `d3-force`
- `dagre`

### Data, charts, and state

- `axios`
- `lodash`
- `lodash.debounce`
- `recharts`
- `zustand`
- `@tanstack/react-query`

### Browser and extension integration

- `webextension-polyfill`
- `socket.io-client`

### Miscellaneous UI helpers

- `cheerio`
- `clsx`
- `qtip2`
- `react-google-recaptcha`
- `react-joyride`
- `react-circular-progressbar`
- `react-icons`
- `jQuery`

## Extension

### UI and browser runtime

- `react`
- `react-dom`
- `@chakra-ui/react`
- `react-router-dom`
- `webextension-polyfill`

### Scraping, parsing, and extraction

- `axios`
- `cheerio`
- `puppeteer`
- `jsonrepair`
- `pdf-parse`
- `pdf2pic`
- `pdfjs-dist`
- `youtube-transcript`
- `youtube-transcript-api`

### State, motion, and display

- `zustand`
- `framer-motion`
- `react-icons`
- `react-circular-progressbar`
- `react-d3-speedometer`
- `redux-devtools-extension`
- `storage`

### Build tooling

- `webpack`
- `vite`
- `ts-loader`
- `dotenv-webpack`
- `copy-webpack-plugin`
- `image-webpack-loader`
- `css-loader`
- `style-loader`

### Supporting utilities

- `fs-extra`
- `oauth`
- `jsonwebtoken`
- `mysql`

## Notes

- This inventory covers direct dependencies declared in the package manifests.
- It does not include transitive dependencies pulled in by those packages.
- Some packages are duplicated across surfaces because the backend, dashboard, extension, and shared code each have different runtime needs.
