import { redirect } from "next/navigation";

// Default to canonical HOOD token on Robinhood Chain
const HOOD_TOKEN_ADDRESS = "0x274c8c4665c0343730c78b184e560f902a8bf200";

export default function TradeIndexPage() {
  redirect(`/trade/${HOOD_TOKEN_ADDRESS}`);
}
