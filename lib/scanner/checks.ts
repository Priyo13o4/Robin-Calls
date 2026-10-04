// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



export { checkDangerousSelectors, checkSerialClone, checkUpgradeability, hasDispatcherSelector, scoreDangerousFunctions } from "./checks/audit-scoring";

export { checkDeployerPulledLiquidity, checkExplorerScamFlag, checkFunderRugHistory, checkImpersonation } from "./checks/critical-overrides";

export type { CustodyDisagreement, MarketDeepestAnchor } from "./checks/custody-findings";

export { checkLpCustody, marketVenueName, poolCustodyFinding, reconcileMarketAnchoredDeepest, resolveCustodyHeadline } from "./checks/custody-findings";

export type { AssessedPool, CustodyFinding, CustodyState } from "./checks/custody-materiality";

export { AUDIT_PENDING_TAIL, CONSIDERABLE_ALTERNATE_POOL_SHARE, LOW_IMPACT_CUSTODY_WARN_DEDUCTION, WHALE_AUDIT_MAX, applyMateriality, applyWhaleAuditToFinding, applyWhaleAudits, boundCustodyJobsByShare, buildAssessedPoolEntry, poolDepthKey, rankV4PoolsByLiquidity, selectMaterialPools, shareKeyOf, v2CustodyFinding, virtualTokenReserve, whaleAuditSubject } from "./checks/custody-materiality";

export { checkHolderConcentration, checkOwnership, reconcileOwnershipWithAudit, reconcileUpgradeabilityWithAudit, redistributeEscrowedStake } from "./checks/holders-ownership";

export { WASH_THRESHOLDS, checkBytecodeFingerprint, checkContractAge, checkFdvLiquidityRatio, checkLiquidityDepth, checkPaidPromotion, checkPoolAge, checkSourceVerification, checkTaxManipulation, checkVolumeTurnover, checkWashTrading } from "./checks/market-checks";

export { checkDeployerHistory, checkFundingLineage, checkLaunchpadProvenance } from "./checks/provenance-history";

export type { CloneAssessment, LineageAssessment, ScanContext } from "./checks/shared";

export { slotToAddress } from "./checks/shared";

export { deployerIsShared, historySubject } from "./checks/subject-origin";