/** Read-only deployed-router probe. Funds only an ephemeral eth_simulateV1 state.
 * No credentials, signing, transaction submission, database or environment access.
 */
import { writeFileSync } from 'node:fs';
import { encodeFunctionData, erc20Abi, keccak256, parseAbi, toHex, type Hex } from 'viem';
import { buildV4Plan } from '../lib/swap/v4-plan';
import { assertPlanSafe } from '../lib/swap/plan-guard';
import { UNISWAP_UR, WETH } from '../lib/swap/venues';
import { PONS_V2_REVIEWED_HOOK, ZIA_BRIDGE_REVIEWED_HOOK } from '../lib/swap/reviewed-hooks';
import { NATIVE, type Address } from '../lib/swap/types';
import { buildUrPlan, type V4PoolKey } from '../lib/swap/ur-plan';

async function main() {
 const endpoint = 'https://rpc.mainnet.chain.robinhood.com';
 const account: Address = '0x1111111111111111111111111111111111111234';
 const feeRecipient: Address = '0x1111111111111111111111111111111111115678';
 const usdg: Address = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
 const token: Address = '0xf0b6c137a803aaa5dba0bd3fe785c012d8c77fdc';
 const keys: V4PoolKey[] = [
  {currency0: WETH, currency1: usdg, fee: 0x800000, tickSpacing: 1, hooks: ZIA_BRIDGE_REVIEWED_HOOK.address},
  {currency0: usdg, currency1: token, fee: 0, tickSpacing: 200, hooks: PONS_V2_REVIEWED_HOOK.address},
 ];
 let calls = 0;
 const methods: Record<string, number> = {};
 async function request(method: string, params: unknown[]): Promise<any> {
  if (++calls > 20) throw new Error('20-request probe cap reached');
  methods[method] = (methods[method] ?? 0) + 1;
  const r = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc:'2.0',id:calls,method,params}), signal: AbortSignal.timeout(20000)});
  const body = await r.json();
  if (!r.ok || body.error) throw new Error(JSON.stringify(body.error ?? {status:r.status}));
  return body.result;
 }
 const block = await request('eth_getBlockByNumber', ['latest',false]);
 const gasPrice = BigInt(await request('eth_gasPrice', [])) * 2n;
 const hashes = [];
 for (const h of [ZIA_BRIDGE_REVIEWED_HOOK,PONS_V2_REVIEWED_HOOK]) {
  const actual = keccak256(await request('eth_getCode',[h.address,block.number]));
  hashes.push({address:h.address,expected:h.expectedRuntimeCodeHash,actual});
  if (actual !== h.expectedRuntimeCodeHash) throw new Error(`Hook runtime mismatch: ${h.address}`);
 }
 const deadline = BigInt(block.timestamp) + 1800n;
 const build = (path: V4PoolKey[], tokenIn: Address, tokenOut: Address, amountIn: bigint) => {
  const plan = buildV4Plan({profile:UNISWAP_UR, leg:{protocol:'v4',v4Key:path[0]},v4Path:path,tokenIn,tokenOut,amountIn,minOut:1n,expectedOut:1n,feeBps:100,feeRecipient,deadline},usdg,undefined,path);
  assertPlanSafe(plan.data,{profile:UNISWAP_UR,tokenIn,tokenOut,minOut:1n,feeBps:100,feeRecipient,nowSeconds:Number(BigInt(block.timestamp)),v4Path:path,approvedHookPoolKeys:path,route:{type:path.length===2?'multihop':'direct',...(path.length===2?{bridge:usdg}:{})}});
  return plan;
 };
 const call = (to: Address, data: Hex, value = 0n) => ({from:account,to,data,value:toHex(value),gas:'0x7a1200',maxFeePerGas:toHex(gasPrice),maxPriorityFeePerGas:'0x0'});
 const balance = (asset: Address, holder: Address) => call(asset, encodeFunctionData({abi:erc20Abi,functionName:'balanceOf',args:[holder]}));
 const sim = async (txs: ReturnType<typeof call>[]) => { await new Promise((resolve) => setTimeout(resolve,1500)); return request('eth_simulateV1',[{validation:true,blockStateCalls:[{stateOverrides:{[account]:{balance:toHex(10n**20n)}},calls:txs}]},block.number]); };
 const evidence: any = {timestamp:new Date().toISOString(),chainId:4663,blockNumber:block.number,router:UNISWAP_UR.router,hookRuntimeHashes:hashes,feeBps:100,amountIn:'1000000000000000',limitations:'Synthetic funded account, minOut=1, pinned public state. Not a real wallet authorization or a price/slippage recommendation.',cases:[]};
 const aapl: Address = '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9';
 const cases = [
  {name:'V4 ETH -> WETH/USDG', out:usdg, make:(reverse:boolean, amount:bigint) => build([keys[0]],reverse?usdg:NATIVE,reverse?NATIVE:usdg,amount)},
  {name:'V4 ETH -> WETH/USDG -> USDG/MERID', out:token, make:(reverse:boolean, amount:bigint) => build(reverse?[...keys].reverse():keys,reverse?token:NATIVE,reverse?NATIVE:token,amount)},
  ...[false,true].map((twoHop) => ({name: twoHop?'V3 ETH -> WETH/USDG -> USDG/AAPL':'V3 ETH -> WETH/AAPL',out:aapl,
    make:(reverse:boolean, amount:bigint) => {
      const tokenIn = reverse?aapl:NATIVE, tokenOut=reverse?NATIVE:aapl;
      const plan = buildUrPlan({profile:UNISWAP_UR,leg:{protocol:'v3',feeTier:500},tokenIn,tokenOut,amountIn:amount,minOut:1n,expectedOut:1n,feeBps:100,feeRecipient,deadline,
        ...(twoHop?{multihop:{bridge:usdg,leg1FeeTier:500,leg2FeeTier:500}}:{})},usdg);
      assertPlanSafe(plan.data,{profile:UNISWAP_UR,tokenIn,tokenOut,minOut:1n,feeBps:100,feeRecipient,nowSeconds:Number(BigInt(block.timestamp)),route:{type:twoHop?'multihop':'direct',...(twoHop?{bridge:usdg,feeTiers:[500,500]}:{})}});
      return plan;
    }
  })),
 ];
 for (const scenario of cases) {
  try {
  const out = scenario.out;
  const buy = scenario.make(false,10n**15n);
  const buyCall = call(buy.to,buy.data,buy.value);
  const result = await sim([buyCall,balance(out,account),balance(WETH,UNISWAP_UR.router),balance(usdg,UNISWAP_UR.router),balance(out,UNISWAP_UR.router)]);
  const row: any = {path:scenario.name,buy:result};
  if (result[0]?.calls[0]?.status === '0x1') {
   const acquired = BigInt(result[0].calls[1].returnData);
   row.acquired = acquired.toString();
   if (acquired>0n) {
    const sell = scenario.make(true,acquired);
    const approveToken = call(out,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[UNISWAP_UR.permit2,acquired]}));
    const approvePermit = call(UNISWAP_UR.permit2,encodeFunctionData({abi:parseAbi(['function approve(address token, address spender, uint160 amount, uint48 expiration)']),functionName:'approve',args:[out,UNISWAP_UR.router,acquired,Number(deadline)]}));
    row.roundtrip = await sim([buyCall,approveToken,approvePermit,call(sell.to,sell.data,sell.value),balance(out,account),balance(WETH,UNISWAP_UR.router),balance(usdg,UNISWAP_UR.router),balance(out,UNISWAP_UR.router)]);
   }
  }
  evidence.cases.push(row);
  console.log(row.path, 'buy status',result[0]?.calls[0]?.status,'return',result[0]?.calls[0]?.returnData,'acquired',row.acquired,'sell status',row.roundtrip?.[0]?.calls[3]?.status);
  } catch (error) { evidence.cases.push({path:scenario.name,status:'unavailable',detail:String(error)}); console.log(scenario.name,String(error)); }
 }
 evidence.rpcRequests=calls; evidence.rpcMethods=methods;
 writeFileSync('/tmp/robincalls-swap-v4-execution-evidence.json',JSON.stringify(evidence,null,2));
}
if (require.main===module) main().catch(e=>{console.error(e);process.exitCode=1;});
