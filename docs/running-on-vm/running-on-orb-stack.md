# installation in orb-stack vm (ubuntu)
[Quick start orb-stack](https://docs.orbstack.dev/quick-start)
- `orb sudo passwd $USER` - (password: orb)
- `ssh orb`
- <pre>sudo apt install zsh vim curl\
	git-core unzip pkg-config\
	openssh-server cargo\
	build-essential\
	libssl-dev\
	libnspr4\
	libnss3\
	libatk1.0-0t64\
	libatk-bridge2.0-0t64\
	libcups2t64\
	libxkbcommon0\
	libasound2t64\
	libgbm1\
	libcairo2\
	libpango-1.0-0\
	libxcomposite1\
	libxdamage1\
	libxfixes3\
	libxrandr2\
	libatspi2.0-0t64</pre>

## switch to zsh
- `chsh -s $(which zsh)` - (password: orb)
	- or `sudo usermod -s $(which zsh) wharsojo`

## install sheldon
[Manual Installation](https://sheldon.cli.rs/Installation.html)
- `cargo install sheldon`
- `vim ~/.zshrc` - (A)ppend
```
export PATH="$HOME/.cargo/bin:$PATH"
eval "$(sheldon source)"
```

# configure sheldon
- `mkdir -p ~/.config/sheldon`
- `vim ~/.config/sheldon/plugins.toml`
```
# `sheldon` configuration file
# ----------------------------
#
# You can modify this file directly or you can use one of the following
# `sheldon` commands which are provided to assist in editing the config file:
#
# - `sheldon add` to add a new plugin to the config file
# - `sheldon edit` to open up the config file in the default editor
# - `sheldon remove` to remove a plugin from the config file
#
# See the documentation for more https://github.com/rossmacarthur/sheldon#readme

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
```
- exit from orb vm
- `ssh orb`

# install fnm
curl -fsSL https://fnm.vercel.app/install | bash
- `vim ~/.zshrc` - (A)ppend
- copy env var `ZAI_API_KEY` to `~/.zshrc`
```
# fnm
FNM_PATH="/home/wharsojo/.local/share/fnm"
if [ -d "$FNM_PATH" ]; then
  export PATH="$FNM_PATH:$PATH"
  eval "$(fnm env --shell bash)"
fi
```
- exit from orb vm
- `ssh orb`
- `fnm install 26.13.0`
- `npm install -g pnpm`

# run dsi-insight
- `mkdir ~/agentic-ai`
- `npx @deepseek-insight/dsi@latest dsh --sync --zai`
