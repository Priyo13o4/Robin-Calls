/** Execute a selected V3 path only in an ephemeral eth_simulateV1 state.
 * Both routing engines use the same app execution policy, router and setup.
 */
import { encodeFunctionData, erc20Abi, parseAbi, toHex, type Hex } from 'viem';
import { buildUrPlan } from '../lib/swap/ur-plan';
import { buildV4Plan } from '../lib/swap/v4-plan';
import { assertPlanSafe } from '../lib/swap/plan-guard';
import { UNISWAP_UR, WETH } from '../lib/swap/venues';
import { ZIA_BRIDGE_REVIEWED_HOOK } from '../lib/swap/reviewed-hooks';
import { NATIVE, type Address } from '../lib/swap/types';

export async function simulateSelectedV3Route(
  request: (method: string, params: unknown[]) => Promise<any>,
  input: { tokenIn: Address; tokenOut: Address; amountIn: bigint; fees: number[]; bridge?: Address; block: bigint },
) {
  const started = Date.now();
  const account: Address = '0x1111111111111111111111111111111111111234';
  const feeRecipient: Address = '0x1111111111111111111111111111111111115678';
  const usdg: Address = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
  const now = Math.floor(Date.now()/1000), deadline=BigInt(now+1800);
  const call = (to: Address, data: Hex, value=0n) => ({from:account,to,data,value:toHex(value),gas:'0x7a1200',maxFeePerGas:'0x3b9aca00',maxPriorityFeePerGas:'0x0'});
  try {
    if (input.fees.length < 1 || input.fees.length > 2) throw new Error('Only one or two V3 pools are supported');
    const tokenIn = input.tokenIn.toLowerCase() as Address;
    const setup = [];
    if (tokenIn === WETH) {
      setup.push(call(WETH,encodeFunctionData({abi:parseAbi(['function deposit() payable']),functionName:'deposit'}),input.amountIn));
    } else if (tokenIn === usdg) {
      // Seed USDG through a DIFFERENT V4 pool so the benchmarked V3 state is unchanged.
      const key = {currency0:WETH,currency1:usdg,fee:0x800000,tickSpacing:1,hooks:ZIA_BRIDGE_REVIEWED_HOOK.address};
      const seed=buildV4Plan({profile:UNISWAP_UR,leg:{protocol:'v4',v4Key:key},tokenIn:NATIVE,tokenOut:usdg,amountIn:10n**15n,minOut:input.amountIn,expectedOut:input.amountIn,feeBps:0,feeRecipient,deadline},usdg,key);
      setup.push(call(seed.to,seed.data,seed.value));
    } else throw new Error('Benchmark funding supports WETH/USDG inputs only');
    setup.push(call(tokenIn,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[UNISWAP_UR.permit2,input.amountIn]})));
    setup.push(call(UNISWAP_UR.permit2,encodeFunctionData({abi:parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)']),functionName:'approve',args:[tokenIn,UNISWAP_UR.router,input.amountIn,Number(deadline)]})));
    const plan=buildUrPlan({profile:UNISWAP_UR,leg:{protocol:'v3',feeTier:input.fees[0]},tokenIn,tokenOut:input.tokenOut,amountIn:input.amountIn,minOut:1n,expectedOut:1n,feeBps:100,feeRecipient,deadline,
      ...(input.bridge?{multihop:{bridge:input.bridge,leg1FeeTier:input.fees[0],leg2FeeTier:input.fees[1]}}:{})},usdg);
    assertPlanSafe(plan.data,{profile:UNISWAP_UR,tokenIn,tokenOut:input.tokenOut,minOut:1n,feeBps:100,feeRecipient,nowSeconds:now,route:{type:input.bridge?'multihop':'direct',bridge:input.bridge,feeTiers:input.fees}});
    const read=(asset:Address,holder:Address)=>call(asset,encodeFunctionData({abi:erc20Abi,functionName:'balanceOf',args:[holder]}));
    const calls=[...setup,call(plan.to,plan.data,plan.value),read(input.tokenOut,account),read(input.tokenOut,UNISWAP_UR.router),read(tokenIn,UNISWAP_UR.router),read(tokenIn,feeRecipient)];
    const blocks=await request('eth_simulateV1',[{validation:true,blockStateCalls:[{stateOverrides:{[account]:{balance:toHex(10n**20n)}},calls}]},toHex(input.block)]);
    const results=blocks[0]?.calls;
    if (!results || results.length !== calls.length || results.some((c:any)=>c.status !== '0x1')) {
      return {status:'unavailable',detail:'A setup, swap or balance-read call failed',elapsedMs:Date.now()-started,raw:blocks};
    }
    const at=(i:number)=>BigInt(results[i].returnData).toString();
    return {status:'simulated',amountOutRaw:at(4),routerOutputResidue:at(5),routerInputResidue:at(6),feePaidRaw:at(7),gasUsed:results[3].gasUsed,elapsedMs:Date.now()-started,router:UNISWAP_UR.router,raw:blocks};
  } catch (error) { return {status:'unavailable',detail:String(error),elapsedMs:Date.now()-started}; }
}
