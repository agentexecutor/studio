# xterm.js, vendored

The Terminal tab draws shells with [xterm.js](https://github.com/xtermjs/xterm.js).
These files are copied unchanged from its npm packages, so the UI keeps
working with no build step. Both packages are MIT licensed; their licenses
are next to them and are embedded in `ax-studio` with the files.

| File | From |
| --- | --- |
| `xterm.js` | `@xterm/xterm` 5.5.0, `lib/xterm.js` |
| `xterm.css` | `@xterm/xterm` 5.5.0, `css/xterm.css` |
| `LICENSE-xterm` | `@xterm/xterm` 5.5.0, `LICENSE` |
| `addon-fit.js` | `@xterm/addon-fit` 0.10.0, `lib/addon-fit.js` |
| `LICENSE-addon-fit` | `@xterm/addon-fit` 0.10.0, `LICENSE` |

The npm tarballs these came from:

- `@xterm/xterm@5.5.0`: `sha512-hqJHYaQb5OptNunnyAnkHyM8aCjZ1MEIDTQu1iIbbTD/xops91NB5yq1ZK/dC2JDbVWtF23zUtl9JE2NqwT87A==`
- `@xterm/addon-fit@0.10.0`: `sha512-UFYkDm4HUahf2lnEyHvio51TNGiLK66mqP2JoATy7hRZeXaGMRDr00JiSF7m63vR5WKATF605yEggJKsw0JpMQ==`

The source map comment at the end of each script names a `.map` file that
isn't vendored. Browsers only ask for it when their developer tools are open.

## Updating

In a scratch directory outside this repository:

```sh
npm pack @xterm/xterm@<version> @xterm/addon-fit@<version>
tar -xzf xterm-xterm-<version>.tgz
```

Check each tarball against the `integrity` npm lists for it, copy the files
above over these, update this page, and check the Terminal tab against a
running task: a prompt, Tab completion, a full-screen program such as `top`,
and a resize.
