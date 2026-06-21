if not status is-interactive
  exit
end

# Initialization
function fish_greeting
  fortune -s
end
pyenv init - | source
source (rbenv init -|psub)
zoxide init fish | source

# $PATH setup
fish_add_path /opt/homebrew/bin
fish_add_path ~/.cargo/bin
fish_add_path ~/.local/bin
set -x ANDROID_SDK_ROOT $HOME/Library/Android/sdk
fish_add_path $ANDROID_SDK_ROOT/emulator
fish_add_path $ANDROID_SDK_ROOT/platform-tools
fish_add_path /opt/homebrew/opt/openjdk/bin

# Default ENV
set -x EDITOR nvim
set -x HOMEBREW_NO_ENV_HINTS 1

# Load color scheme
fish_config theme choose catppuccin-mocha

# Prompt config
fish_vi_key_bindings

# Aliases

alias ls='eza -l --git --group-directories-first --time-style=iso --icons'
alias tree='eza -T --git-ignore -I "**/node_modules" --icons --group-directories-first'
alias cat='bat'
alias lg='lazygit'
alias pinentry='pinentry-mac'

# Automatically switch node version based on .nvmrc
function nvm_use_on_dir --on-variable PWD
  if status is-interactive
    if test -e ./.nvmrc || test -e ../.nvmrc || test -e ../../.nvmrc || test -e ../../../.nvmrc
      nvm use --silent
    else
      nvm use system --silent
    end
  end
end

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/opt/homebrew/share/google-cloud-sdk/path.fish.inc' ]; . '/opt/homebrew/share/google-cloud-sdk/path.fish.inc'; end

source /Users/gaby/.safe-chain/scripts/init-fish.fish # Safe-chain Fish initialization script
# aikido-endpoint-cert-config-start
# Allow Node.js tooling to trust the SafeChain MITM CA while preserving public roots.
set -gx NODE_EXTRA_CA_CERTS "/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-combined-ca.pem"
# aikido-endpoint-cert-config-end
# aikido-endpoint-pip-cert-config-start
# Allow Python package managers to trust the SafeChain MITM CA while preserving user-provided roots.
set -gx PIP_CERT "/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-pip-combined-ca.pem"
set -gx REQUESTS_CA_BUNDLE "/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-pip-combined-ca.pem"
set -gx POETRY_CERTIFICATES_PYPI_CERT "/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-pip-combined-ca.pem"
set -gx UV_SYSTEM_CERTS true
# aikido-endpoint-pip-cert-config-end
# aikido-endpoint-ruby-cert-config-start
# Allow Ruby Bundler to trust the SafeChain MITM CA while preserving public roots.
set -gx BUNDLE_SSL_CA_CERT "/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-ruby-combined-ca.pem"
# aikido-endpoint-ruby-cert-config-end
# aikido-endpoint-curl-cert-config-start
# Allow curl and other OpenSSL-linked tools to trust the SafeChain MITM CA while preserving the system roots.
set -gx CURL_CA_BUNDLE "/Library/Application Support/AikidoSecurity/EndpointProtection/run/endpoint-protection-openssl-combined-ca.pem"
# aikido-endpoint-curl-cert-config-end
