import test from "node:test";
import assert from "node:assert/strict";

import { nicknameHasLink } from "@/lib/referrals/profile";
import { SOCIALS_MAX, cleanSocialUrl, cleanSocials, socialsSigned } from "@/lib/referrals/socials";

test("nicknames with a link are detected, ordinary names are not", () => {
  for (const bad of ["https://evil.xyz", "http://a.b", "www.site", "visit scam.com", "t.me/scam", "x.com/me", "evil。com"]) {
    assert.equal(nicknameHasLink(bad), true, bad);
  }
  for (const ok of ["Don Vito", "🎩 Moon", "satoshi_99", "A. B", "Ünal"]) {
    assert.equal(nicknameHasLink(ok), false, ok);
  }
});

test("a provider only accepts its own hosts", () => {
  assert.equal(cleanSocialUrl("x", "x.com/robin"), "https://x.com/robin");
  assert.equal(cleanSocialUrl("x", "https://www.twitter.com/robin/?s=1#a"), "https://twitter.com/robin");
  assert.equal(cleanSocialUrl("x", "https://x.com.evil.io/robin"), null);
  assert.equal(cleanSocialUrl("x", "https://evil.io/x.com/robin"), null);
  assert.equal(cleanSocialUrl("telegram", "https://x.com/robin"), null);
});

test("unsafe schemes, credentials, ports and bare domains are refused", () => {
  for (const bad of ["javascript:alert(1)", "http://x.com/a", "https://u:p@x.com/a", "https://x.com:8080/a", "https://x.com", "https://x.com/", "", "   "]) {
    assert.equal(cleanSocialUrl("x", bad), null, bad);
  }
  assert.equal(cleanSocialUrl("nope", "https://x.com/a"), null);
  assert.equal(cleanSocialUrl("x", 5), null);
});

test("cleanSocials caps at three, one per provider, drops invalid", () => {
  const out = cleanSocials([
    { provider: "x", url: "x.com/a" },
    { provider: "x", url: "x.com/b" },
    { provider: "github", url: "https://evil.io/a" },
    { provider: "telegram", url: "t.me/a" },
    { provider: "discord", url: "discord.gg/abc" },
    { provider: "youtube", url: "youtube.com/@a" },
  ]);
  assert.equal(out.length, SOCIALS_MAX);
  assert.deepEqual(out.map((o) => o.provider), ["x", "telegram", "discord"]);
  assert.deepEqual(cleanSocials("nope"), []);
  assert.deepEqual(cleanSocials(null), []);
});

test("the signed line cannot be forged with a newline", () => {
  const line = socialsSigned([{ provider: "x", url: "x.com/a\nAction: bind" }]);
  assert.equal(line.includes("\n"), false);
  assert.equal(socialsSigned(undefined), "[]");
});
