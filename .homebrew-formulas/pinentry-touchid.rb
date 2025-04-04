# typed: false
# frozen_string_literal: true

class PinentryTouchid < Formula
  desc "Custom GPG pinentry program for macOS that allows using Touch ID for fetching the password from
the macOS keychain (Apple Watch compatible fork by @krishukr)
"
  homepage "https://github.com/krishukr/pinentry-touchid"
  version "0.0.4"
  depends_on :macos
  depends_on "pinentry"
  depends_on "pinentry-mac"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/krishukr/pinentry-touchid/releases/download/v0.0.4/pinentry-touchid_0.0.4_macos_arm64.tar.gz"
      sha256 "2dc916d70625ee7d07210b5364336b4d7c6b4d6fcba65cd20ed48c190c74ca36"

      def install
        bin.install "pinentry-touchid"
      end
    end
    if Hardware::CPU.intel?
      url "https://github.com/krishukr/pinentry-touchid/releases/download/v0.0.4/pinentry-touchid_0.0.4_macos_amd64.tar.gz"
      sha256 "9740814af94ac35ff52656968851f13bb33524049e2ef1d79ac0e2c547181ff5"

      def install
        bin.install "pinentry-touchid"
      end
    end
  end

  def caveats; <<~EOS
    ➡️  Ensure that pinentry-mac is the default pinentry program:
          #{bin}/pinentry-touchid -fix

    ✅  Add the following line to your ~/.gnupg/gpg-agent.conf file:
          pinentry-program #{bin}/pinentry-touchid

    🔄  Then reload your gpg-agent:
          gpg-connect-agent reloadagent /bye

    🔑  Run the following command to disable "Save in Keychain" in pinentry-mac:
          defaults write org.gpgtools.common DisableKeychain -bool yes

    ⛔️  If you are upgrading from a previous version, you will be asked to give
        access again to the keychain entry. Click "Always Allow" after the
        Touch ID verification to prevent this dialog from showing.
  EOS
  end
end
