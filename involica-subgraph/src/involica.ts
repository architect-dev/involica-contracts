import { BigInt } from "@graphprotocol/graph-ts"
import {
  Involica,
  ClearTask,
  DepositTreasury,
  ExitPosition,
  FinalizeDCA,
  InitializeTask,
  MinSlippageSet,
  OwnershipTransferred,
  PausePosition,
  Paused,
  PositionUpdated,
  SetAllowedToken,
  SetBlacklistedPair,
  SetInvolicaTreasury,
  SetInvolicaTxFee,
  SetPaused,
  SetPosition,
  SetResolver,
  Unpaused,
  WithdrawTreasury
} from "../generated/Involica/Involica"
import { ExampleEntity } from "../generated/schema"

export function handleClearTask(event: ClearTask): void {
  // Entities can be loaded from the store using a string ID; this ID
  // needs to be unique across all entities of the same type
  let entity = ExampleEntity.load(event.transaction.from.toHex())

  // Entities only exist after they have been saved to the store;
  // `null` checks allow to create entities on demand
  if (!entity) {
    entity = new ExampleEntity(event.transaction.from.toHex())

    // Entity fields can be set using simple assignments
    entity.count = BigInt.fromI32(0)
  }

  // BigInt and BigDecimal math are supported
  entity.count = entity.count + BigInt.fromI32(1)

  // Entity fields can be set based on event parameters
  entity.user = event.params.user
  entity.taskId = event.params.taskId

  // Entities can be written to the store with `.save()`
  entity.save()

  // Note: If a handler doesn't require existing field values, it is faster
  // _not_ to load the entity from the store. Instead, create it fresh with
  // `new Entity(...)`, set the fields that should be updated and save the
  // entity back to the store. Fields that were not set or unset remain
  // unchanged, allowing for partial updates to be applied.

  // It is also possible to access smart contracts from mappings. For
  // example, the contract that has emitted the event can be connected to
  // with:
  //
  // let contract = Contract.bind(event.address)
  //
  // The following functions can then be called on this contract to access
  // state variables and other data:
  //
  // - contract.ETH(...)
  // - contract.NATIVE_TOKEN(...)
  // - contract.blacklistedPairs(...)
  // - contract.dcaRevertCondition(...)
  // - contract.fetchAllowedToken(...)
  // - contract.fetchAllowedTokens(...)
  // - contract.fetchUniRouter(...)
  // - contract.fetchUserPosition(...)
  // - contract.fetchUserTreasury(...)
  // - contract.fetchUserTxs(...)
  // - contract.gelato(...)
  // - contract.involicaTreasury(...)
  // - contract.minSlippage(...)
  // - contract.ops(...)
  // - contract.owner(...)
  // - contract.paused(...)
  // - contract.positions(...)
  // - contract.resolver(...)
  // - contract.txFee(...)
  // - contract.uniRouter(...)
  // - contract.userTreasuries(...)
  // - contract.userTxs(...)
  // - contract.weth(...)
}

export function handleDepositTreasury(event: DepositTreasury): void {}

export function handleExitPosition(event: ExitPosition): void {}

export function handleFinalizeDCA(event: FinalizeDCA): void {}

export function handleInitializeTask(event: InitializeTask): void {}

export function handleMinSlippageSet(event: MinSlippageSet): void {}

export function handleOwnershipTransferred(event: OwnershipTransferred): void {}

export function handlePausePosition(event: PausePosition): void {}

export function handlePaused(event: Paused): void {}

export function handlePositionUpdated(event: PositionUpdated): void {}

export function handleSetAllowedToken(event: SetAllowedToken): void {}

export function handleSetBlacklistedPair(event: SetBlacklistedPair): void {}

export function handleSetInvolicaTreasury(event: SetInvolicaTreasury): void {}

export function handleSetInvolicaTxFee(event: SetInvolicaTxFee): void {}

export function handleSetPaused(event: SetPaused): void {}

export function handleSetPosition(event: SetPosition): void {}

export function handleSetResolver(event: SetResolver): void {}

export function handleUnpaused(event: Unpaused): void {}

export function handleWithdrawTreasury(event: WithdrawTreasury): void {}
