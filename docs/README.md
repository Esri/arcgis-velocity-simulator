# Documentation

[Repository overview](../README.md#documentation) · [Command-line reference](command-line.md)

This folder holds every guide for the ArcGIS Velocity Simulator. Each guide is
self-contained, starts with a short scope and audience statement, and links to
its closest siblings at the bottom. Start with the guide that matches your task;
the audience column tells you whether a guide is written for people running the
application, people changing it, or both.

Ready-to-copy launch configuration files live in `docs/examples/` and are
documentation samples rather than runtime configuration.

## Guides

| | Guide | Purpose | Audience |
|---|-------|---------|----------|
| 📦 | [Build and release](build-and-release.md) | Prerequisites, local and multi-platform builds, platform packaging, code signing, release commands, and troubleshooting. | Developers |
| ⌨️ | [Command-line reference](command-line.md) | Every parameter with its supported values, default, headless requirement, and example, plus help layouts. | Users and developers |
| 🎚 | [Connection presets](connection-presets.md) | The paired Simulator and Logger presets, what each one pre-fills, the Custom and Custom (modified) states, and the connection-row progressive disclosure. | Users and developers |
| ⚙️ | [Configuration](configuration.md) | App Config and Launch Config settings, themes, fonts, platform storage locations, launch configuration samples, and reset steps. | Users and developers |
| 🧑‍💻 | [Developer guide](developer-guide.md) | Repository structure, local development, tests, documentation checks, debugging, logging, and how to add controls, transports, and themes. | Developers |
| 🔌 | [gRPC transport](grpc.md) | Client and server modes, Protobuf, Kryo, and Text serialization, remote procedure call types, TLS, and metadata. | Users and developers |
| 🤖 | [Headless mode](headless.md) | No-UI replay sessions, headless parameters, the launch configuration workflow, and the `doneFile` artifact. | Users and developers |
| 🌐 | [HTTP and HTTPS transport](http.md) | Client and server modes, JSON, CSV, Esri JSON, GeoJSON, and XML formats, TLS, and metadata. | Users and developers |
| ⌘ | [Keyboard shortcuts](keyboard-shortcuts.md) | Every shortcut, the context menu reference, and the in-app dialog shortcuts. | Users |
| 🎙️ | [Offline speech recognition](offline-speech.md) | Local voice control: setup, supported commands, frequency analysis internals, and troubleshooting. | Users and developers |
| 🔒 | [TLS and SSL security](tls.md) | Certificate types, operating system trust stores, mutual TLS, automatic self-signed certificates, and the TLS Trust Badge. | Users and developers |
| 🔑 | [ArcGIS Velocity sign-in and feed picker](velocity-login.md) | ArcGIS Velocity sign-in, feed browsing, token-based authentication, and auto-configuration. | Users |
| 🔗 | [WebSocket transport](websocket.md) | Client and server modes, formats, TLS, subscription messages, and custom headers. | Users and developers |
| 💬 | [XMPP transport](xmpp.md) | Client and server roles, Direct and Room conversations, STARTTLS policies, accounts and JID rules, and explicit limitations. | Users and developers |

## Launch configuration samples

| | Sample | Purpose |
|---|--------|---------|
| 📄 | [Generic sample](examples/launch-config.sample.json) | Every supported section and key. |
| 📥 | [Server-mode sample](examples/launch-config.server.sample.json) | Binds locally and replays immediately. |
| 📤 | [Client-mode sample](examples/launch-config.client.sample.json) | Connects to an existing endpoint. |
| 💬 | [XMPP sample](examples/launch-config.xmpp.sample.json) | Signs in as an XMPP client on port 5222 and publishes to a recipient. |

Copy a sample, adjust the values, and pass it with `config=<path>`; values
supplied on the command line always override values loaded from the file. The
key list is documented in [Configuration](configuration.md) and the workflow in
[Headless mode](headless.md).

## Where to start

| | Task | Read this |
|---|------|-----------|
| 🏁 | Run the application for the first time | [Repository overview](../README.md), then [Keyboard shortcuts](keyboard-shortcuts.md). |
| 🧵 | Stream a file to an ArcGIS Velocity feed | The transport guide for your protocol, then [TLS and SSL security](tls.md). |
| 🗓️ | Schedule an unattended replay | [Headless mode](headless.md), then the launch configuration samples above. |
| 🧑‍💻 | Change the application | [Developer guide](developer-guide.md). |
| 📤 | Publish a build | [Build and release](build-and-release.md). |

## Maintaining this documentation

Documentation is part of the change, not a follow-up task. When a pull request
changes behavior, update the affected guide in the same pull request.

- Keep every guide current and task-oriented. Do not add historical narratives, changelogs, migration chronologies, or summaries that duplicate another guide.
- Add a new guide as a lowercase kebab-case `.md` file in this folder; list it in the table above and in the repository overview catalog.
- Update the transport guide, `src/help.html`, and the tooltip reference tables together whenever a control, its tooltip, or a parameter changes.
- Update [Command-line reference](command-line.md), [Headless mode](headless.md), [Configuration](configuration.md), and the samples in `docs/examples/` together whenever a parameter, default, or required rule changes.
- Run `npm run docs:check-links` before opening a pull request; it verifies every relative link and heading anchor in this folder and in the repository overview.

The authoring rules that these guides follow — file naming, the guide skeleton,
navigation, tables of contents, link style, terminology, and which guide owns
which topic — are recorded in [`AGENTS.md`](../AGENTS.md) at the repository root.
