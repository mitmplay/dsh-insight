# installation in orb-stack vm (debian)
[Quick start orb-stack](https://docs.orbstack.dev/quick-start)

## Install system packages
- `orb sudo passwd $USER` - (password: orb)
  - TWO prompts in sequence: `New password:` then `Retype new password:` —
    type `orb` at EACH. A trailing blank line at the first prompt is eaten
    as the retype → `Sorry, passwords do not match` → password unchanged.
- `ssh debian@orb` (passwordless — OrbStack injects its key)
<pre>
sudo apt update
# sudo is passwordless for the OrbStack user; if it ever prompts, password: orb
sudo apt install -y \
	zsh \
	vim \
	curl \
	git \
	unzip \
	pkg-config \
	cargo \
	build-essential \
	libssl-dev \
	libnspr4 \
	libnss3 \
	libatk1.0-0t64 \
	libatk-bridge2.0-0t64 \
	libcups2t64 \
	libxkbcommon0 \
	libasound2t64 \
	libgbm1 \
	libcairo2 \
	libpango-1.0-0 \
	libxcomposite1 \
	libxdamage1 \
	libxfixes3 \
	libxrandr2 \
	libatspi2.0-0t64 \
	fonts-noto-core \
	fonts-noto-cjk \
	fonts-noto-color-emoji
	</pre>

## switch to zsh
- `sudo usermod -s "$(which zsh)" "$(whoami)"` ← PREFER THIS (root, no password prompt)
  - fallback: `chsh -s $(which zsh)` - (password: orb)

## install sheldon
[Manual Installation](https://sheldon.cli.rs/Installation.html)
- Debian's `cargo` (apt) is TOO OLD — deps need rustc ≥1.86 and the build
  fails with `Try re-running cargo install with --locked`. Install rustup first:
  - `curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal`
  - `source "$HOME/.cargo/env"`
- `cargo install sheldon` (a few minutes; ends `Installed package `sheldon v0.8.x``)
- append to `~/.zshrc` (no editor needed — paste-safe):
```
printf '%s\n' 'export PATH="$HOME/.cargo/bin:$PATH"' 'eval "$(sheldon source)"' >> ~/.zshrc
```

## configure sheldon
- `mkdir -p ~/.config/sheldon`
- write `~/.config/sheldon/plugins.toml` with a quoted heredoc (no editor;
  `<<'EOF'` keeps `$hook`/`{{ }}` unexpanded):
```
cat > ~/.config/sheldon/plugins.toml <<'EOF'
shell = "zsh"

[templates]
defer = "{{ hooks?.pre | nl }}{% for file in files %}zsh-defer source \"{{ file }}\"\n{% endfor %}{{ hooks?.post | nl }}"

[plugins]

[plugins.powerlevel10k]
github = "romkatv/powerlevel10k"

[plugins.zsh-defer]
github = "romkatv/zsh-defer"

[plugins.base16]
github = "chriskempson/base16-shell"

[plugins.oh-my-zsh]
github = "ohmyzsh/ohmyzsh"

[plugins.zsh-syntax-highlighting]
github = "zsh-users/zsh-syntax-highlighting"
apply = ["defer"]
EOF
```

## Reconnect:
- `exit`
- `ssh debian@orb`
- first reconnect launches the **Powerlevel10k config wizard** — it eats all
  further keystrokes. Answer `q` (Quit) to skip it, or finish the wizard
  interactively. Until then the shell looks frozen: that is the wizard.

## install fnm
`curl -fsSL https://fnm.vercel.app/install | bash`
- the installer APPENDS the fnm block to `~/.zshrc` itself (`--shell zsh`
  variant) — no manual vim step needed; it also prints `source ~/.zshrc`.
- copy env var `ZAI_API_KEY` from the mac into `~/.zshrc`:
```
echo 'export ZAI_API_KEY=<value-from-mac-zsh>' >> ~/.zshrc
```
  - note: typing this on a live terminal leaves the value in scrollback.

## Reload & Install Nodejs:
- `source ~/.zshrc`
- `fnm install 26.13.0`
- `fnm use 26.13.0`
- `fnm default 26.13.0`
- `npm install -g pnpm`

## run dsi-insight
- `mkdir -p ~/agentic-ai && cd ~/agentic-ai`
- `npx -y @deepseek-insight/dsi@latest dsh --sync --zai`
  - first run downloads playwright chromium + the pinned DSH host — minutes.
  - the host runs FOREGROUND (listens on 127.0.0.1:5174, web on :3080) — this
    is the end state, not a hang. It prints `dsh web: http://127.0.0.1:3080/?token=…`.