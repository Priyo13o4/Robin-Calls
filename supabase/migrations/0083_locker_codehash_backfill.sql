-- 0083 — L66/L65: record the bytecode every lp-locker row is actually vouching for
--
-- Six of the ten `lp-locker` rows carried no `codehash` at all, and 58 of the
-- 67 verdicts that rest on a locker rested on one of those rows — including the
-- most-cited row on the chain (Launchpad V2, 43 verdicts). An all-clear that
-- cannot name the bytecode it audited cannot show its own basis.
--
-- Every value below was READ from the chain on 2026-09-05 via eth_getCode +
-- keccak256, never hand-entered (L66's trap: the two FeeSplitter rows stored
-- `0x8238e5106b3a8955`, a correct but truncated 16-hex prefix — right value,
-- unusable as a fingerprint, and an exact-match check would have called it a
-- MISMATCH and demoted genuinely locked liquidity).
--
-- Chain facts measured in the same pass, which is why L65 no longer needs a
-- periodic re-verify job: none of the ten is an EIP-1967 proxy, and none has
-- SELFDESTRUCT or DELEGATECALL in its executable region. Code at these
-- addresses cannot change, so the fingerprint is recorded to show the basis of
-- the claim, not to watch for drift.
--
-- `runtimeCodeBytes` is code + metadata, matching eth_getCode. The Launchpad V2
-- row previously read 1916, which is the executable region with the 53-byte
-- CBOR trailer excluded — two different measurements of "the code", not an
-- error in either.
update trusted_address t
set metadata = t.metadata || jsonb_build_object(
      'codehash', m.codehash,
      'codehashVerifiedAt', '2026-09-05',
      'runtimeCodeBytes', m.bytes
    ),
    updated_at = now()
from (values
  ('0x2f9878d39173b9711136547ac0f84555153ce230', '0xe5590f61fa9a21c85fa1fc0dd6a7ad739ab7ac3e2a2850416de6e4d123d362fd',  3302),
  ('0xad69d8a00564f4a2365cc74594925f95281706aa', '0xee4522db997a71e396e90ef14a123f3a4a857268040b17a618ff2f47e204eb4a',  3583),
  ('0x267444d099b10fb5ed7c3cc7b7c767adca574952', '0x58455f80b3773871d601a025e56ec27c71ab3bbb8e2ca6b17828954450742025',  1969),
  ('0xc10309cf03bc81c121a8270e3a28e159a9296903', '0x22211f2d836a45a0f6636dc127e2581f027128f401f37e0add32fb2532bb7d39',  5416),
  ('0x736d76699c26d0d966744cae304c000d471f7f35', '0xa7880a625a649da833de5597c9f41585bb75e20ef91d45830ccc6f4e49cc281c',  5426),
  ('0x134d32ea27ba2abb28cf210b5dc814f33ea570b5', '0x359f72ce97e9a36ab4ca1440381b646a5f00ff331360ec2a028da4baeeba3abe',  6176),
  ('0xf28704c691290547924e2129d407da36bda8ce0f', '0x325ad147a61d60ecaee0e60d066043f956c789a14a341c93429e966f9371d210', 23902),
  ('0xeff166aaf189323c58dc27ed1206eb2c37faacdf', '0x8238e5106b3a895514083110d1f3b4e51be61148604f35113719af56ae325f42',  7260),
  ('0x222d6d4f1ce59b0d48d5505114ec8addc90a4359', '0x8238e5106b3a895514083110d1f3b4e51be61148604f35113719af56ae325f42',  7260),
  ('0xf441cc979fa862f2674b9188a7b529cafd3ce204', '0x8719cb80384fc0b9387cd4fecee27d0a0d4f14eaa3f7a164636bb9972d7bcfd2', 10125)
) as m(address, codehash, bytes)
where t.address = m.address
  and t.chain_id = 4663
  and t.category = 'lp-locker';
