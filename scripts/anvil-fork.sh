#!/bin/bash
# Fork chain 4663 locally so a real wallet can click through a real buy and sell
# without spending real money.
#
#   ./scripts/anvil-fork.sh                      # fork at latest
#   ./scripts/anvil-fork.sh --fund 0xYourWallet  # fork, then fund that address with ETH
#
# Runbook, traps and the MetaMask steps: docs/swap-fork/RUNBOOK.md
#
# WHY 0.0.0.0 AND NOT 127.0.0.1: the Next app runs in a container. A listener bound to
# loopback is reachable from the Mac and from nothing else, so the browser would work,
# the server would not, and the panel would show "could not load" with no clue why.
set -euo pipefail

PORT="${ANVIL_PORT:-8545}"
UPSTREAM="${ROBINHOOD_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
FUND=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fund) FUND="${2:?--fund needs an address}"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is already listening on port $PORT. Stop it, or pass --port." >&2
  exit 1
fi

echo "Forking $UPSTREAM at latest..."
echo "  chain id 4663, so the app's chain check and Permit2's domain separator both hold."

# --chain-id 4663 is NOT cosmetic. The panel refuses any other chain, and a Permit2
# signature is bound to the chain id it was signed under: a fork on 31337 produces
# signatures the real Permit2 would reject, which is the opposite of what we are testing.
#
# HARDFORK TRAP (Cancun vs Shanghai):
# 1. Why Shanghai is UNSUPPORTED for execution: Shanghai allows simple reads like USDG
#    symbol(), but cannot execute the deployed Uniswap Universal Router (0x8876789976decbfcbbbe364623c63652db8c0904).
#    The router bytecode was compiled for Cancun and executes Cancun opcodes (TLOAD 0x5c,
#    TSTORE 0x5d, MCOPY 0x5e), which immediately fail on Shanghai with `EVM error NotActivated`.
# 2. Why raw Cancun fails on Orbit chains: The upstream Orbit block carried no excessBlobGas
#    field. On Anvil 1.8.1 Cancun, every eth_call against the unmined fork block fails with
#    `-32602: Excess blob gas not set`.
# 3. Workaround: Bootstrap the local chain by mining an initial block via `evm_mine` once Anvil
#    is responsive. The mined block (N+1) initializes excessBlobGas: 0x0, allowing both contract
#    reads AND Cancun Universal Router execution to succeed.
anvil \
  --fork-url "$UPSTREAM" \
  --chain-id 4663 \
  --hardfork cancun \
  --host 0.0.0.0 \
  --port "$PORT" \
  --steps-tracing \
  &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 40); do
  if curl -fs -X POST "http://127.0.0.1:$PORT" -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Bootstrap local Cancun block header with excessBlobGas: 0x0 via evm_mine.
# Without this initial block, revm fails with -32602 Excess blob gas not set on every call
# because the upstream Orbit block header has no blob gas fields.
curl -s -X POST "http://127.0.0.1:$PORT" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"evm_mine","params":[]}' >/dev/null

CHAIN=$(curl -s -X POST "http://127.0.0.1:$PORT" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  | sed 's/.*"result":"\([^"]*\)".*/\1/')
BLOCK=$(curl -s -X POST "http://127.0.0.1:$PORT" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
  | sed 's/.*"result":"\([^"]*\)".*/\1/')

if [[ "$CHAIN" != "0x1237" ]]; then
  echo "anvil reports chain $CHAIN, expected 0x1237 (4663). Refusing to continue." >&2
  exit 1
fi

# A fork that cannot answer eth_call is worse than no fork: it looks healthy and turns every
# read into an empty answer. USDG is a fixed, verified token on this chain, so its symbol() is
# a read that must always succeed. Refuse to hand over a fork that fails it.
PROBE=$(curl -s -X POST "http://127.0.0.1:$PORT" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x5fc5360d0400a0fd4f2af552add042d716f1d168","data":"0x95d89b41"},"latest"]}')
if [[ "$PROBE" != *'"result"'* ]]; then
  echo "This fork cannot answer eth_call, so every contract read would come back empty." >&2
  echo "  $PROBE" >&2
  echo "Refusing to continue." >&2
  exit 1
fi

# Concrete Cancun execution probe: Uniswap Universal Router execute()
# Calling execute() with empty commands on Shanghai fails with "EVM error NotActivated"
# because the deployed bytecode contains Cancun opcodes (TLOAD/TSTORE/MCOPY).
# On a working Cancun fork, it returns "0x".
UR_PROBE=$(curl -s -X POST "http://127.0.0.1:$PORT" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x8876789976decbfcbbbe364623c63652db8c0904","data":"0x3593564c0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000002540be3ff00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"},"latest"]}')
if [[ "$UR_PROBE" != *'"result"'* ]]; then
  echo "This fork cannot execute Cancun Universal Router (execution probe failed):" >&2
  echo "  $UR_PROBE" >&2
  echo "Refusing to continue." >&2
  exit 1
fi

if [[ -n "$FUND" ]]; then
  echo "Funding $FUND with 100 ETH..."
  curl -s -X POST "http://127.0.0.1:$PORT" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"anvil_setBalance\",\"params\":[\"$FUND\",\"0x56BC75E2D63100000\"]}" >/dev/null
fi

cat <<EOF

  anvil is up. chain 4663, forked at block $((BLOCK)).

  Set these for the app, then restart it. Do NOT edit ROBINHOOD_RPC_URL:
  fork mode is its own pair so that forgetting to unset it leaves a fork
  running, never production pointed at your laptop.

    SWAP_FORK_MODE=1
    SWAP_FORK_RPC_URL=http://host.docker.internal:$PORT   # the app, in its container
    NEXT_PUBLIC_RPC_URL=http://127.0.0.1:$PORT            # the browser and MetaMask, on the Mac

  Those two URLs are DIFFERENT on purpose and both point at this process.
  One is how a container reaches your Mac; the other is how your browser does.

  MetaMask: edit your existing 4663 network's RPC to http://127.0.0.1:$PORT.
  Do not add a second network with the same chain id.

  Ctrl-C stops the fork and throws away every trade made on it.

EOF

wait $ANVIL_PID
