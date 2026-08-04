cask "framewright" do
  arch arm: "arm64", intel: "x64"

  version "1.1.14"
  sha256 arm:   "e669ab7c8bdd4596211937183ee2374545da5482702cab0dfe477c1466422b0f",
         intel: "85f5183219de0b656400625797ff9299893bd8fbda8455b0f745878b2c729526"

  # NOTE: version/sha256/url still point at Recordly's last release as placeholders —
  # this cask targets a repo/release that doesn't exist yet under the Framewright name.
  # Update these once Framewright has its own tagged release with signed DMGs.
  url "https://github.com/sakshamtushar/framewright/releases/download/v#{version}/Framewright-#{arch}.dmg"
  name "Framewright"
  desc "Creator-focused screen recorder with auto-zoom, cursor effects, and more"
  homepage "https://github.com/sakshamtushar/framewright"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Framewright.app"

  zap trash: [
    "~/Library/Application Support/Framewright",
    "~/Library/Preferences/dev.framewright.app.plist",
    "~/Library/Saved Application State/dev.framewright.app.savedState",
  ]
end
