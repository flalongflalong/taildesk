# Third-party notices

Taildesk-authored code is licensed under the [MIT License](LICENSE). This does not relicense dependencies, upstream code excerpts, or generated third-party modules. This source distribution does not bundle `node_modules`, Python packages, or compiled `dist` assets.

## noVNC 1.7.0

- Source: [noVNC v1.7.0](https://github.com/novnc/noVNC/tree/v1.7.0).
- Core license: Mozilla Public License 2.0. The upstream package also contains components under other licenses; see [its license overview](licenses/novnc/LICENSE.txt), [authors](licenses/novnc/AUTHORS), and [MPL text](licenses/novnc/docs/LICENSE.MPL-2.0).
- The bundled pako code has its own [MIT notice](licenses/novnc/vendor/pako/LICENSE). Other upstream license texts are retained under `licenses/novnc/docs/` for reference.
- `scripts/novnc-orientation.mjs` matches excerpts of the upstream RFB module and transforms its coordinate, gesture, and viewport calls at build time. Those upstream excerpts and the resulting modified noVNC module retain their upstream MPL terms. Taildesk's independent application files are MIT.
- The exact dependency is pinned in `package-lock.json`; the transformation and its local helper (`src/remote/orientation.ts`) are included in this repository, so the modified module can be reproduced from source. Installing does not rewrite the noVNC package on disk.
- If distributing a compiled bundle, provide the applicable notices and corresponding noVNC source, including the modifications. Do not label the generated noVNC chunk as MIT-only. See the [MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) for the upstream explanation of file-level coverage and distribution requirements.

## websockify 0.13.0

- Source: [websockify v0.13.0](https://github.com/novnc/websockify/tree/v0.13.0).
- License: LGPL version 3; see [upstream COPYING](https://github.com/novnc/websockify/blob/v0.13.0/COPYING).
- Installed as a separate Python dependency and launched in a local subprocess. Taildesk does not vendor or replace its source files. If redistributing this dependency, preserve its license and comply with its source-availability requirements.

## Other direct runtime dependencies

| Dependency | License | Source / notice |
| --- | --- | --- |
| React and React DOM | MIT | [React](https://github.com/facebook/react), [React notice](licenses/react-LICENSE), [React DOM notice](licenses/react-dom-LICENSE) |
| Lucide React | ISC, with Feather-derived portions under MIT | [Lucide](https://github.com/lucide-icons/lucide), [notice](licenses/lucide-LICENSE) |
| FastAPI | MIT | [Source](https://github.com/fastapi/fastapi) |
| Uvicorn | BSD-3-Clause | [Source](https://github.com/encode/uvicorn) |
| websockets | BSD-3-Clause | [Source](https://github.com/python-websockets/websockets) |
| python-dotenv | BSD-3-Clause | [Source](https://github.com/theskumar/python-dotenv) |

Exact JavaScript versions and package integrity values are recorded in `package-lock.json`; direct Python versions are recorded in `requirements.txt`. Development tools and transitive dependencies retain their own licenses supplied with their packages. This table is not an exhaustive inventory of a separately built binary or container distribution.

## Names and design references

Tailscale is separately installed network software, not bundled here. Screens and ToDesk informed some interaction choices; Taildesk does not incorporate their services or assets and is not affiliated with their vendors.
