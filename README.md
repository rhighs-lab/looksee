![looksee](assets/banner.png)

<p align="center"><strong>Review your work before every push.</strong></p>

A GitHub-style diff of your working tree that updates live while your coding
agent edits.

<p align="center"><img src="assets/loop.svg" alt="review loop"></p>

## Quick start

```bash
git clone https://github.com/rhighs-lab/looksee
cd looksee && pnpm install && pnpm build && pnpm link --global
cd ../your-repo && looksee review .   # opens http://127.0.0.1:4711
```

```
looksee --help
```

## Credits

Inspired by [prequel](https://github.com/mdesjardins/prequel).
